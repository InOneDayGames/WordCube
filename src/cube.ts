export const CUBE_SIZE = 3

export const DIRECTIONS = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const
export const DEFAULT_LETTER_WEIGHTS: Array<[string, number]> = [
  ['E', 11],
  ['A', 9],
  ['I', 8],
  ['O', 8],
  ['N', 6],
  ['R', 7],
  ['T', 6],
  ['L', 6],
  ['S', 6],
  ['D', 5],
  ['C', 4],
  ['M', 3],
  ['P', 3],
  ['U', 1],
  ['B', 4],
  ['G', 3],
  ['F', 1],
  ['H', 2],
  ['W', 2],
  ['Y', 2],
  ['K', 1],
  ['V', 1],
  ['X', 0.5],
  ['J', 0.25],
  ['Q', 0.25],
  ['Z', 0.25],
]
export const MINIMUM_LETTER_WEIGHTS: Array<[string, number]> = [
  ['J', 0.25],
  ['Q', 0.25],
  ['X', 0.5],
  ['Z', 0.25],
]
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U'])

export type Direction = (typeof DIRECTIONS)[number]
export type RandomSource = () => number
export type LetterWeights = Array<[string, number]>
type WeightedLetterBag = {
  entries: Array<{ letter: string; cumulativeWeight: number }>
  totalWeight: number
}
export type CubeGenerationOptions = {
  letterWeights?: LetterWeights
  random?: RandomSource
}

export type Block = {
  id: string
  x: number
  y: number
  z: number
  removed: boolean
  letters: Record<Direction, string>
}

export type FaceRef = {
  key: string
  blockId: string
  x: number
  y: number
  z: number
  direction: Direction
  letter: string
  corners: string[]
}

export type CubeState = {
  blocks: Block[]
}

type Octant = [number, number, number]

type DirectionVector = {
  x: number
  y: number
  z: number
}

const DIRECTION_VECTORS: Record<Direction, DirectionVector> = {
  px: { x: 1, y: 0, z: 0 },
  nx: { x: -1, y: 0, z: 0 },
  py: { x: 0, y: 1, z: 0 },
  ny: { x: 0, y: -1, z: 0 },
  pz: { x: 0, y: 0, z: 1 },
  nz: { x: 0, y: 0, z: -1 },
}

export function createCubeState(options: CubeGenerationOptions = {}): CubeState {
  const letterWeights = options.letterWeights ?? DEFAULT_LETTER_WEIGHTS
  const random = options.random ?? Math.random
  const letterBag = createWeightedLetterBag(letterWeights)
  const blocks: Block[] = []

  for (let x = 0; x < CUBE_SIZE; x += 1) {
    for (let y = 0; y < CUBE_SIZE; y += 1) {
      for (let z = 0; z < CUBE_SIZE; z += 1) {
        blocks.push({
          id: blockKey(x, y, z),
          x,
          y,
          z,
          removed: false,
          letters: {
            px: drawWeightedLetter(letterBag, random),
            nx: drawWeightedLetter(letterBag, random),
            py: drawWeightedLetter(letterBag, random),
            ny: drawWeightedLetter(letterBag, random),
            pz: drawWeightedLetter(letterBag, random),
            nz: drawWeightedLetter(letterBag, random),
          },
        })
      }
    }
  }

  return { blocks }
}

export function getExposedFaces(cube: CubeState): FaceRef[] {
  return cube.blocks
    .filter((block) => !block.removed)
    .flatMap((block) =>
      DIRECTIONS.filter((direction) => isFaceExposed(cube, block, direction)).map((direction) => ({
        key: faceKey(block.id, direction),
        blockId: block.id,
        x: block.x,
        y: block.y,
        z: block.z,
        direction,
        letter: block.letters[direction],
        corners: getFaceCorners(block, direction),
      })),
    )
}

export function buildFaceMap(faces: FaceRef[]): Map<string, FaceRef> {
  return new Map(faces.map((face) => [face.key, face]))
}

export function canAppendFace(
  selection: string[],
  nextFaceKey: string,
  faceMap: Map<string, FaceRef>,
  cube: CubeState,
): boolean {
  if (selection.length === 0) {
    return faceMap.has(nextFaceKey)
  }

  if (selection.includes(nextFaceKey)) {
    return false
  }

  const previous = faceMap.get(selection[selection.length - 1])
  const next = faceMap.get(nextFaceKey)

  if (!previous || !next) {
    return false
  }

  return facesAreSurfaceAdjacent(previous, next, cube)
}

export function selectionToWord(selection: string[], faceMap: Map<string, FaceRef>): string {
  return selection
    .map((faceKeyValue) => faceMap.get(faceKeyValue)?.letter ?? '')
    .join('')
}

export function removeSelectedBlocks(cube: CubeState, selection: string[], faceMap: Map<string, FaceRef>) {
  const blockIds = new Set(
    selection
      .map((faceKeyValue) => faceMap.get(faceKeyValue)?.blockId)
      .filter((blockId): blockId is string => Boolean(blockId)),
  )

  return {
    blocks: cube.blocks.map((block) =>
      blockIds.has(block.id)
        ? {
            ...block,
            removed: true,
          }
        : block,
    ),
  }
}

export function countRemainingBlocks(cube: CubeState): number {
  return cube.blocks.filter((block) => !block.removed).length
}

export function countLetters(cube: CubeState): Map<string, number> {
  const counts = new Map<string, number>()

  for (const block of cube.blocks) {
    for (const direction of DIRECTIONS) {
      const letter = block.letters[direction]
      counts.set(letter, (counts.get(letter) ?? 0) + 1)
    }
  }

  return counts
}

export function countVowels(cube: CubeState): number {
  let vowels = 0

  for (const block of cube.blocks) {
    for (const direction of DIRECTIONS) {
      if (VOWELS.has(block.letters[direction])) {
        vowels += 1
      }
    }
  }

  return vowels
}

export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0

  return () => {
    state += 0x6d2b79f5
    let next = state
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

export function createWeightedLetterBag(letterWeights: LetterWeights): WeightedLetterBag {
  const entries: WeightedLetterBag['entries'] = []
  let totalWeight = 0

  for (const [letter, weight] of letterWeights) {
    if (weight <= 0) {
      continue
    }

    totalWeight += weight
    entries.push({
      letter,
      cumulativeWeight: totalWeight,
    })
  }

  if (entries.length === 0 || totalWeight <= 0) {
    throw new Error('Letter bag must contain at least one positive weight')
  }

  return {
    entries,
    totalWeight,
  }
}

function isFaceExposed(cube: CubeState, block: Block, direction: Direction): boolean {
  const vector = DIRECTION_VECTORS[direction]
  const neighbor = cube.blocks.find(
    (candidate) =>
      !candidate.removed &&
      candidate.x === block.x + vector.x &&
      candidate.y === block.y + vector.y &&
      candidate.z === block.z + vector.z,
  )

  return !neighbor
}

function getFaceCorners(block: Block, direction: Direction): string[] {
  const x0 = block.x
  const x1 = block.x + 1
  const y0 = block.y
  const y1 = block.y + 1
  const z0 = block.z
  const z1 = block.z + 1

  switch (direction) {
    case 'px':
      return [cornerKey(x1, y0, z0), cornerKey(x1, y1, z0), cornerKey(x1, y0, z1), cornerKey(x1, y1, z1)]
    case 'nx':
      return [cornerKey(x0, y0, z0), cornerKey(x0, y1, z0), cornerKey(x0, y0, z1), cornerKey(x0, y1, z1)]
    case 'py':
      return [cornerKey(x0, y1, z0), cornerKey(x1, y1, z0), cornerKey(x0, y1, z1), cornerKey(x1, y1, z1)]
    case 'ny':
      return [cornerKey(x0, y0, z0), cornerKey(x1, y0, z0), cornerKey(x0, y0, z1), cornerKey(x1, y0, z1)]
    case 'pz':
      return [cornerKey(x0, y0, z1), cornerKey(x1, y0, z1), cornerKey(x0, y1, z1), cornerKey(x1, y1, z1)]
    case 'nz':
      return [cornerKey(x0, y0, z0), cornerKey(x1, y0, z0), cornerKey(x0, y1, z0), cornerKey(x1, y1, z0)]
  }
}

function facesAreSurfaceAdjacent(a: FaceRef, b: FaceRef, cube: CubeState): boolean {
  const sharedCorners = a.corners.filter((corner) => b.corners.includes(corner))

  if (sharedCorners.length >= 2) {
    return facesShareReachableEdge(a, b, cube, sharedCorners)
  }

  if (sharedCorners.length === 1) {
    return facesShareReachableCorner(a, b, cube, sharedCorners[0])
  }

  return false
}

function facesShareReachableEdge(a: FaceRef, b: FaceRef, cube: CubeState, sharedCorners: string[]): boolean {
  const edgeAxis = getEdgeAxis(sharedCorners[0], sharedCorners[1])

  if (!edgeAxis) {
    return false
  }

  const edgeMidpoint = getEdgeMidpoint(sharedCorners[0], sharedCorners[1])
  const emptyQuadrants = getEmptyQuadrantsAroundEdge(cube, edgeMidpoint, edgeAxis)
  const outsideQuadrantsA = getFaceOutsideQuadrants(a.direction, edgeAxis)
  const outsideQuadrantsB = getFaceOutsideQuadrants(b.direction, edgeAxis)

  return outsideQuadrantsA.some(
    (quadrantA) =>
      emptyQuadrants.has(quadrantKey(quadrantA)) &&
      outsideQuadrantsB.some((quadrantB) => quadrantKey(quadrantA) === quadrantKey(quadrantB)),
  )
}

function facesShareReachableCorner(a: FaceRef, b: FaceRef, cube: CubeState, sharedCorner: string): boolean {
  // Diagonal moves are only legal through connected empty space around the shared vertex.
  const outsideOctantA = getFaceOutsideOctantAtCorner(a, sharedCorner)
  const outsideOctantB = getFaceOutsideOctantAtCorner(b, sharedCorner)

  if (!outsideOctantA || !outsideOctantB) {
    return false
  }

  const emptyOctants = getEmptyOctantsAroundCorner(cube, parseCornerKey(sharedCorner))
  const startKey = octantKey(outsideOctantA)
  const targetKey = octantKey(outsideOctantB)

  if (!emptyOctants.has(startKey) || !emptyOctants.has(targetKey)) {
    return false
  }

  return emptyOctantsAreConnected(startKey, targetKey, emptyOctants)
}

function getFaceOutsideOctantAtCorner(face: FaceRef, cornerKeyValue: string): Octant | null {
  const corner = parseCornerKey(cornerKeyValue)
  const x = getFaceCornerAxisSign(face, corner, 'x')
  const y = getFaceCornerAxisSign(face, corner, 'y')
  const z = getFaceCornerAxisSign(face, corner, 'z')

  if (x === null || y === null || z === null) {
    return null
  }

  return [x, y, z]
}

function getFaceCornerAxisSign(
  face: FaceRef,
  corner: { x: number; y: number; z: number },
  axis: 'x' | 'y' | 'z',
): number | null {
  if (getDirectionAxis(face.direction) === axis) {
    const sign = getDirectionSign(face.direction)
    const expectedCoordinate = face[axis] + (sign > 0 ? 1 : 0)

    return corner[axis] === expectedCoordinate ? sign : null
  }

  if (corner[axis] === face[axis]) {
    return 1
  }

  if (corner[axis] === face[axis] + 1) {
    return -1
  }

  return null
}

function getDirectionAxis(direction: Direction): 'x' | 'y' | 'z' {
  if (direction === 'px' || direction === 'nx') {
    return 'x'
  }

  if (direction === 'py' || direction === 'ny') {
    return 'y'
  }

  return 'z'
}

function getDirectionSign(direction: Direction): number {
  return direction.startsWith('p') ? 1 : -1
}

function getEmptyOctantsAroundCorner(cube: CubeState, corner: { x: number; y: number; z: number }): Set<string> {
  const occupied = new Set<string>()

  for (const block of cube.blocks) {
    if (block.removed || !blockTouchesCorner(block, corner)) {
      continue
    }

    occupied.add(octantKey(getBlockOctant(block, corner)))
  }

  return new Set(ALL_OCTANT_KEYS.filter((key) => !occupied.has(key)))
}

function blockTouchesCorner(block: Block, corner: { x: number; y: number; z: number }): boolean {
  return (
    block.x <= corner.x &&
    corner.x <= block.x + 1 &&
    block.y <= corner.y &&
    corner.y <= block.y + 1 &&
    block.z <= corner.z &&
    corner.z <= block.z + 1
  )
}

function getBlockOctant(block: Block, corner: { x: number; y: number; z: number }): Octant {
  return [
    octantSign(block.x + 0.5 - corner.x),
    octantSign(block.y + 0.5 - corner.y),
    octantSign(block.z + 0.5 - corner.z),
  ]
}

function octantSign(value: number): number {
  return value < 0 ? -1 : 1
}

function emptyOctantsAreConnected(startKey: string, targetKey: string, emptyOctants: ReadonlySet<string>): boolean {
  if (startKey === targetKey) {
    return true
  }

  const visited = new Set<string>([startKey])
  const queue = [startKey]

  while (queue.length > 0) {
    const current = queue.shift()

    if (!current) {
      break
    }

    for (const neighbor of getAdjacentOctantKeys(current)) {
      if (!emptyOctants.has(neighbor) || visited.has(neighbor)) {
        continue
      }

      if (neighbor === targetKey) {
        return true
      }

      visited.add(neighbor)
      queue.push(neighbor)
    }
  }

  return false
}

function getAdjacentOctantKeys(key: string): string[] {
  const octant = parseOctantKey(key)

  return [0, 1, 2].map((index) => {
    const neighbor: Octant = [...octant]
    neighbor[index] *= -1
    return octantKey(neighbor)
  })
}

const ALL_OCTANT_KEYS = [
  '-1,-1,-1',
  '-1,-1,1',
  '-1,1,-1',
  '-1,1,1',
  '1,-1,-1',
  '1,-1,1',
  '1,1,-1',
  '1,1,1',
] as const

function octantKey(octant: Octant): string {
  return `${octant[0]},${octant[1]},${octant[2]}`
}

function parseOctantKey(key: string): Octant {
  const [x, y, z] = key.split(',').map(Number)
  return [x, y, z]
}

function getEdgeAxis(cornerA: string, cornerB: string): 'x' | 'y' | 'z' | null {
  const a = parseCornerKey(cornerA)
  const b = parseCornerKey(cornerB)

  if (a.x !== b.x) {
    return 'x'
  }

  if (a.y !== b.y) {
    return 'y'
  }

  if (a.z !== b.z) {
    return 'z'
  }

  return null
}

function getFaceOutsideQuadrants(
  direction: Direction,
  edgeAxis: 'x' | 'y' | 'z',
): Array<[number, number]> {
  switch (edgeAxis) {
    case 'x':
      if (direction === 'py') return [[1, -1], [1, 1]]
      if (direction === 'ny') return [[-1, -1], [-1, 1]]
      if (direction === 'pz') return [[-1, 1], [1, 1]]
      return [[-1, -1], [1, -1]]
    case 'y':
      if (direction === 'px') return [[1, -1], [1, 1]]
      if (direction === 'nx') return [[-1, -1], [-1, 1]]
      if (direction === 'pz') return [[-1, 1], [1, 1]]
      return [[-1, -1], [1, -1]]
    case 'z':
      if (direction === 'px') return [[1, -1], [1, 1]]
      if (direction === 'nx') return [[-1, -1], [-1, 1]]
      if (direction === 'py') return [[-1, 1], [1, 1]]
      return [[-1, -1], [1, -1]]
  }
}

function getEmptyQuadrantsAroundEdge(
  cube: CubeState,
  edgeMidpoint: { x: number; y: number; z: number },
  edgeAxis: 'x' | 'y' | 'z',
): Set<string> {
  const occupied = new Set<string>()

  for (const block of cube.blocks) {
    if (block.removed || !blockTouchesEdge(block, edgeMidpoint, edgeAxis)) {
      continue
    }

    occupied.add(quadrantKey(getBlockQuadrant(block, edgeMidpoint, edgeAxis)))
  }

  return new Set(ALL_QUADRANT_KEYS.filter((key) => !occupied.has(key)))
}

function blockTouchesEdge(
  block: Block,
  edgeMidpoint: { x: number; y: number; z: number },
  edgeAxis: 'x' | 'y' | 'z',
): boolean {
  switch (edgeAxis) {
    case 'x':
      return (
        block.x <= edgeMidpoint.x &&
        edgeMidpoint.x <= block.x + 1 &&
        (edgeMidpoint.y === block.y || edgeMidpoint.y === block.y + 1) &&
        (edgeMidpoint.z === block.z || edgeMidpoint.z === block.z + 1)
      )
    case 'y':
      return (
        block.y <= edgeMidpoint.y &&
        edgeMidpoint.y <= block.y + 1 &&
        (edgeMidpoint.x === block.x || edgeMidpoint.x === block.x + 1) &&
        (edgeMidpoint.z === block.z || edgeMidpoint.z === block.z + 1)
      )
    case 'z':
      return (
        block.z <= edgeMidpoint.z &&
        edgeMidpoint.z <= block.z + 1 &&
        (edgeMidpoint.x === block.x || edgeMidpoint.x === block.x + 1) &&
        (edgeMidpoint.y === block.y || edgeMidpoint.y === block.y + 1)
      )
  }
}

function getBlockQuadrant(
  block: Block,
  edgeMidpoint: { x: number; y: number; z: number },
  edgeAxis: 'x' | 'y' | 'z',
): [number, number] {
  switch (edgeAxis) {
    case 'x':
      return [Math.sign(block.y + 0.5 - edgeMidpoint.y), Math.sign(block.z + 0.5 - edgeMidpoint.z)]
    case 'y':
      return [Math.sign(block.x + 0.5 - edgeMidpoint.x), Math.sign(block.z + 0.5 - edgeMidpoint.z)]
    case 'z':
      return [Math.sign(block.x + 0.5 - edgeMidpoint.x), Math.sign(block.y + 0.5 - edgeMidpoint.y)]
  }
}

const ALL_QUADRANT_KEYS = ['-1,-1', '-1,1', '1,-1', '1,1'] as const

function quadrantKey(quadrant: [number, number]): string {
  return `${quadrant[0]},${quadrant[1]}`
}

function getEdgeMidpoint(cornerA: string, cornerB: string) {
  const a = parseCornerKey(cornerA)
  const b = parseCornerKey(cornerB)

  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  }
}

function parseCornerKey(corner: string) {
  const [x, y, z] = corner.split(',').map(Number)
  return { x, y, z }
}

function faceKey(blockId: string, direction: Direction): string {
  return `${blockId}:${direction}`
}

export function createFaceKey(blockId: string, direction: Direction): string {
  return faceKey(blockId, direction)
}

function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

function cornerKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

function drawWeightedLetter(letterBag: WeightedLetterBag, random: RandomSource): string {
  const roll = random() * letterBag.totalWeight

  for (const entry of letterBag.entries) {
    if (roll < entry.cumulativeWeight) {
      return entry.letter
    }
  }

  return letterBag.entries[letterBag.entries.length - 1].letter
}
