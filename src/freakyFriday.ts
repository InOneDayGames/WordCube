import { createFaceKey, createSeededRandom, getExposedFaces, type CubeState, type Direction, type FaceRef } from './cube.js'

const FIVE_POINT_LETTERS = ['J', 'Q', 'X', 'Z'] as const
const THREE_POINT_LETTERS = ['B', 'F', 'K', 'V', 'W', 'Y'] as const
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U'])
const FREAKY_STAMP_SEED_XOR = 0x5f3759df

const FREAKY_FRIDAY_BONUS_BY_LETTER = new Map<string, 3 | 5>([
  ...FIVE_POINT_LETTERS.map((letter) => [letter, 5] as const),
  ...THREE_POINT_LETTERS.map((letter) => [letter, 3] as const),
])

export function getFreakyFridayLetterBonus(letter: string): 0 | 3 | 5 {
  return FREAKY_FRIDAY_BONUS_BY_LETTER.get(letter.toUpperCase()) ?? 0
}

export function scoreFreakyFridayLetterBonuses(word: string): number {
  return word
    .toUpperCase()
    .split('')
    .reduce((total, letter) => total + getFreakyFridayLetterBonus(letter), 0)
}

export function applyFreakyFridayStamp(cube: CubeState, seed: number): CubeState {
  const exposedFaces = getExposedFaces(cube)

  if (exposedFaces.length === 0) {
    return cube
  }

  const random = createSeededRandom((seed ^ FREAKY_STAMP_SEED_XOR) >>> 0)
  const faceOverrides = new Map<string, string>()
  const initialFiveCount = exposedFaces.filter((face) => getFreakyFridayLetterBonus(face.letter) === 5).length
  const initialThreeCount = exposedFaces.filter((face) => getFreakyFridayLetterBonus(face.letter) === 3).length
  const targetFiveCount = Math.max(3, Math.ceil(Math.max(2, initialFiveCount) * 1.5))
  const targetThreeCount = Math.max(3, Math.ceil(initialThreeCount * 2.25))

  while (countVisibleFacesWithBonus(exposedFaces, faceOverrides, 5) < targetFiveCount) {
    const candidate = pickReplacementFace(exposedFaces, faceOverrides, 5, random)

    if (!candidate) {
      break
    }

    faceOverrides.set(createFaceKey(candidate.blockId, candidate.direction), pickReplacementLetter(FIVE_POINT_LETTERS, candidate.letter, random))
  }

  while (countVisibleFacesWithBonus(exposedFaces, faceOverrides, 3) < targetThreeCount) {
    const candidate = pickReplacementFace(exposedFaces, faceOverrides, 3, random)

    if (!candidate) {
      break
    }

    faceOverrides.set(createFaceKey(candidate.blockId, candidate.direction), pickReplacementLetter(THREE_POINT_LETTERS, candidate.letter, random))
  }

  ensureAdjacentUForVisibleQs(cube, exposedFaces, faceOverrides, random)

  if (faceOverrides.size === 0) {
    return cube
  }

  return {
    dimensions: cube.dimensions,
    blocks: cube.blocks.map((block) => ({
      ...block,
      letters: {
        px: faceOverrides.get(createFaceKey(block.id, 'px')) ?? block.letters.px,
        nx: faceOverrides.get(createFaceKey(block.id, 'nx')) ?? block.letters.nx,
        py: faceOverrides.get(createFaceKey(block.id, 'py')) ?? block.letters.py,
        ny: faceOverrides.get(createFaceKey(block.id, 'ny')) ?? block.letters.ny,
        pz: faceOverrides.get(createFaceKey(block.id, 'pz')) ?? block.letters.pz,
        nz: faceOverrides.get(createFaceKey(block.id, 'nz')) ?? block.letters.nz,
      },
    })),
  }
}

function countVisibleFacesWithBonus(
  faces: FaceRef[],
  faceOverrides: ReadonlyMap<string, string>,
  bonus: 3 | 5,
): number {
  return faces.filter((face) => getFreakyFridayLetterBonus(getFaceLetter(face, faceOverrides)) === bonus).length
}

function pickReplacementFace(
  faces: FaceRef[],
  faceOverrides: ReadonlyMap<string, string>,
  targetBonus: 3 | 5,
  random: () => number,
): FaceRef | null {
  const preferred = faces.filter((face) => {
    const currentBonus = getFreakyFridayLetterBonus(getFaceLetter(face, faceOverrides))

    if (targetBonus === 5) {
      return currentBonus === 0 && !VOWELS.has(getFaceLetter(face, faceOverrides))
    }

    return currentBonus === 0 && !VOWELS.has(getFaceLetter(face, faceOverrides))
  })

  const secondary = faces.filter((face) => {
    const currentBonus = getFreakyFridayLetterBonus(getFaceLetter(face, faceOverrides))

    if (targetBonus === 5) {
      return currentBonus === 0 && VOWELS.has(getFaceLetter(face, faceOverrides))
    }

    return currentBonus === 0 && VOWELS.has(getFaceLetter(face, faceOverrides))
  })

  const fallback =
    targetBonus === 5
      ? faces.filter((face) => getFreakyFridayLetterBonus(getFaceLetter(face, faceOverrides)) === 3)
      : []

  return pickFromPool(preferred, random) ?? pickFromPool(secondary, random) ?? pickFromPool(fallback, random)
}

function pickFromPool(faces: FaceRef[], random: () => number): FaceRef | null {
  if (faces.length === 0) {
    return null
  }

  const sortedFaces = [...faces].sort((left, right) => left.key.localeCompare(right.key))
  return sortedFaces[Math.floor(random() * sortedFaces.length)] ?? null
}

function pickReplacementLetter(
  pool: readonly string[],
  currentLetter: string,
  random: () => number,
): string {
  const candidates = pool.filter((letter) => letter !== currentLetter.toUpperCase())

  if (candidates.length === 0) {
    return pool[0]
  }

  return candidates[Math.floor(random() * candidates.length)] ?? candidates[0]
}

function getFaceLetter(face: FaceRef, faceOverrides: ReadonlyMap<string, string>): string {
  return faceOverrides.get(face.key) ?? face.letter
}

function ensureAdjacentUForVisibleQs(
  cube: CubeState,
  exposedFaces: FaceRef[],
  faceOverrides: Map<string, string>,
  random: () => number,
) {
  const exposedFaceKeys = new Set(exposedFaces.map((face) => face.key))
  const blocksById = new Map(cube.blocks.map((block) => [block.id, block]))

  for (const face of exposedFaces) {
    if (getFaceLetter(face, faceOverrides) !== 'Q') {
      continue
    }

    const block = blocksById.get(face.blockId)

    if (!block) {
      continue
    }

    const adjacentDirections = getEdgeAdjacentDirections(face.direction)
    const hasAdjacentU = adjacentDirections.some((direction) => {
      const faceKey = createFaceKey(block.id, direction)
      return (faceOverrides.get(faceKey) ?? block.letters[direction]) === 'U'
    })

    if (hasAdjacentU) {
      continue
    }

    const replacementDirection = pickAdjacentUDirection(block, adjacentDirections, exposedFaceKeys, faceOverrides, random)

    if (!replacementDirection) {
      continue
    }

    faceOverrides.set(createFaceKey(block.id, replacementDirection), 'U')
  }
}

function getEdgeAdjacentDirections(direction: Direction): Direction[] {
  switch (direction) {
    case 'px':
    case 'nx':
      return ['py', 'ny', 'pz', 'nz']
    case 'py':
    case 'ny':
      return ['px', 'nx', 'pz', 'nz']
    case 'pz':
    case 'nz':
      return ['px', 'nx', 'py', 'ny']
  }

  return []
}

function pickAdjacentUDirection(
  block: CubeState['blocks'][number],
  directions: Direction[],
  exposedFaceKeys: ReadonlySet<string>,
  faceOverrides: ReadonlyMap<string, string>,
  random: () => number,
): Direction | null {
  const hiddenNonBonus = directions.filter((direction) =>
    isGoodUCandidate(block, direction, exposedFaceKeys, faceOverrides, true, false),
  )
  const hiddenAny = directions.filter((direction) =>
    isGoodUCandidate(block, direction, exposedFaceKeys, faceOverrides, true, true),
  )
  const visibleNonBonus = directions.filter((direction) =>
    isGoodUCandidate(block, direction, exposedFaceKeys, faceOverrides, false, false),
  )
  const visibleAny = directions.filter((direction) =>
    isGoodUCandidate(block, direction, exposedFaceKeys, faceOverrides, false, true),
  )

  return (
    pickDirection(hiddenNonBonus, random) ??
    pickDirection(hiddenAny, random) ??
    pickDirection(visibleNonBonus, random) ??
    pickDirection(visibleAny, random)
  )
}

function isGoodUCandidate(
  block: CubeState['blocks'][number],
  direction: Direction,
  exposedFaceKeys: ReadonlySet<string>,
  faceOverrides: ReadonlyMap<string, string>,
  requireHidden: boolean,
  allowBonusOverwrite: boolean,
): boolean {
  const faceKey = createFaceKey(block.id, direction)
  const currentLetter = faceOverrides.get(faceKey) ?? block.letters[direction]
  const isExposed = exposedFaceKeys.has(faceKey)

  if (requireHidden !== !isExposed) {
    return false
  }

  if (currentLetter === 'U') {
    return true
  }

  if (!allowBonusOverwrite && getFreakyFridayLetterBonus(currentLetter) > 0) {
    return false
  }

  return !VOWELS.has(currentLetter) || currentLetter === 'U'
}

function pickDirection(directions: Direction[], random: () => number): Direction | null {
  if (directions.length === 0) {
    return null
  }

  const sortedDirections = [...directions].sort((left, right) => left.localeCompare(right))
  return sortedDirections[Math.floor(random() * sortedDirections.length)] ?? null
}
