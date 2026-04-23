import * as THREE from 'three'
import { CUBE_SIZE, DIRECTIONS, createFaceKey, getExposedFaces, type Block, type CubeState, type Direction } from './cube'

const CELL_SIZE = 1
const BLOCK_BODY_SIZE = 0.995
const FACE_SIZE = 1.01
const SURFACE_OFFSET = 0.501
const CUBE_RENDER_SCALE = 1
const CUBE_VERTICAL_OFFSET = 0.0
const DRAG_DEADZONE_PX = 10
const DRAG_RADIANS_PER_PIXEL = 0.006
const MAX_PITCH_RADIANS = Math.PI / 3
const DEFAULT_CAMERA_RADIUS = 12
const COMPACT_CAMERA_RADIUS = 10
const BLOCK_EXTRACTION_MOVE_MS = 80
const BLOCK_EXTRACTION_HOLD_MS = 80
const BLOCK_EXTRACTION_DISTANCE = 0.17
const BLOCK_EXTRACTION_STAGGER_MS = 70
const BLOCK_EXTRACTION_SHRINK_MS = 180
export const CUBE_LETTER_FONT_FAMILY = '"Libre Baskerville"'
type FaceTextureState = 'normal' | 'selected' | 'legal'

export class CubeView {
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly cubeRoot: THREE.Group
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly onFaceSelect: (faceKey: string) => void
  private readonly onYawChange: (yawRadians: number, pitchRadians: number) => void
  private readonly resizeObserver: ResizeObserver
  private readonly textureCache = new Map<string, THREE.CanvasTexture>()
  private faceMeshes: THREE.Mesh[] = []
  private readonly faceMeshByKey = new Map<string, THREE.Mesh>()
  private currentCube: CubeState | null = null
  private selectedFaceKeys = new Set<string>()
  private legalHintFaceKeys = new Set<string>()
  private yawRadians = 0
  private pitchRadians = 0
  private dragYawOffset = 0
  private dragPitchOffset = 0
  private pointerStartX: number | null = null
  private pointerStartY: number | null = null
  private activePointerId: number | null = null
  private dragActive = false
  private removalAnimationFrameId: number | null = null
  private removalHoldTimeoutId: number | null = null
  private removalStaggerTimeoutIds: number[] = []
  private extractionGroup: THREE.Group | null = null
  private extractionVector = new THREE.Vector3(0, 1, 0)

  constructor(
    container: HTMLElement,
    onFaceSelect: (faceKey: string) => void,
    onYawChange: (yawRadians: number, pitchRadians: number) => void,
  ) {
    this.container = container
    this.onFaceSelect = onFaceSelect
    this.onYawChange = onYawChange
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.domElement.style.touchAction = 'none'
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
    this.camera.up.set(0, 1, 0)
    this.camera.position.set(0, 0, DEFAULT_CAMERA_RADIUS)
    this.camera.lookAt(0, 0, 0)

    this.cubeRoot = new THREE.Group()
    this.cubeRoot.scale.setScalar(CUBE_RENDER_SCALE)
    this.cubeRoot.position.y = CUBE_VERTICAL_OFFSET
    this.scene.add(this.cubeRoot)

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4)
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9)
    keyLight.position.set(10, 12, 8)
    this.scene.add(ambientLight, keyLight)

    this.container.append(this.renderer.domElement)
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel)

    this.resizeObserver = new ResizeObserver(() => {
      this.resize()
      this.render()
    })
    this.resizeObserver.observe(this.container)

    this.resize()
    this.render()
  }

  attachTo(container: HTMLElement) {
    if (this.renderer.domElement.parentElement !== container) {
      container.append(this.renderer.domElement)
      this.resize()
      this.render()
    }
  }

  setState(
    cube: CubeState,
    selectedFaceKeys: string[],
    yawRadians: number,
    pitchRadians: number,
    legalHintFaceKeys: string[] = [],
  ) {
    this.yawRadians = yawRadians
    this.pitchRadians = pitchRadians
    this.applyYawRotation()
    if (this.currentCube !== cube) {
      this.rebuildFaces(cube)
      this.currentCube = cube
      this.selectedFaceKeys = new Set()
      this.legalHintFaceKeys = new Set()
    }
    this.updateFaceTextureStates(new Set(selectedFaceKeys), new Set(legalHintFaceKeys))
    this.render()
  }

  destroy() {
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerCancel)
    this.resizeObserver.disconnect()
    this.cancelRemovalAnimation()
    this.disposeExtractionGroup()
    this.textureCache.forEach((texture) => texture.dispose())
    this.textureCache.clear()
    this.renderer.dispose()
  }

  refreshLetterTextures() {
    this.textureCache.forEach((texture) => texture.dispose())
    this.textureCache.clear()

    this.faceMeshes.forEach((mesh) => {
      const material = mesh.material as THREE.MeshBasicMaterial
      material.map = this.getLetterTexture(
        mesh.userData.letter as string,
        mesh.userData.direction as Direction,
        getFaceTextureState(Boolean(mesh.userData.selected), Boolean(mesh.userData.legalHint)),
      )
      material.needsUpdate = true
    })

    this.render()
  }

  prepareBlockExtraction(faceKeys: string[]): boolean {
    if (!this.currentCube || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false
    }

    const targetBlockIds = new Set(
      faceKeys
        .map((faceKey) => this.faceMeshByKey.get(faceKey)?.userData.blockId as string | undefined)
        .filter((blockId): blockId is string => Boolean(blockId)),
    )
    const selectedBlocks = this.currentCube.blocks.filter((block) => !block.removed && targetBlockIds.has(block.id))

    if (selectedBlocks.length === 0) {
      return false
    }

    this.cancelRemovalAnimation()
    this.disposeExtractionGroup()

    const selectedFaceKeys = new Set(faceKeys)
    const selectedBlockIds = new Set(selectedBlocks.map((block) => block.id))
    const selectedBlocksByPosition = new Map(selectedBlocks.map((block) => [blockPositionKey(block), block]))
    const extractionGroup = new THREE.Group()

    for (const block of selectedBlocks) {
      const blockGroup = new THREE.Group()
      blockGroup.position.copy(gridToWorldVector(block.x, block.y, block.z))
      blockGroup.add(createBlockBodyMesh())
      blockGroup.add(createBlockEdgeMesh())

      for (const direction of DIRECTIONS) {
        if (hasSelectedNeighbor(block, direction, selectedBlocksByPosition, selectedBlockIds)) {
          continue
        }

        const faceKey = createFaceKey(block.id, direction)
        const mesh = this.createFaceMesh(
          block.x,
          block.y,
          block.z,
          direction,
          block.letters[direction],
          selectedFaceKeys.has(faceKey),
        )
        mesh.position.sub(blockGroup.position)
        blockGroup.add(mesh)
      }

      if (blockGroup.children.length > 0) {
        extractionGroup.add(blockGroup)
      }
    }

    if (extractionGroup.children.length === 0) {
      return false
    }

    const centroid = selectedBlocks.reduce(
      (sum, block) => sum.add(gridToWorldVector(block.x, block.y, block.z)),
      new THREE.Vector3(),
    ).divideScalar(selectedBlocks.length)
    const extractionVector = centroid.clone()

    if (extractionVector.lengthSq() < 0.01) {
      extractionVector.set(0, 1, 0)
    } else {
      extractionVector.normalize()
      extractionVector.y += 0.22
      extractionVector.normalize()
    }

    this.extractionVector = extractionVector
    this.extractionGroup = extractionGroup
    this.cubeRoot.add(extractionGroup)
    this.render()
    return true
  }

  animatePreparedBlockExtraction(onComplete: () => void): boolean {
    if (!this.extractionGroup) {
      return false
    }

    this.cancelRemovalAnimation()

    const extractionGroup = this.extractionGroup
    const startPosition = extractionGroup.position.clone()
    const startTime = performance.now()

    const finish = () => {
      this.removalAnimationFrameId = null
      this.removalHoldTimeoutId = window.setTimeout(() => {
      this.removalHoldTimeoutId = null
        this.staggerOutExtractionBlocks(onComplete)
      }, BLOCK_EXTRACTION_HOLD_MS)
    }

    const animateFrame = (time: number) => {
      const progress = clamp((time - startTime) / BLOCK_EXTRACTION_MOVE_MS, 0, 1)
      const easedProgress = easeOutCubic(progress)
      const offset = this.extractionVector.clone().multiplyScalar(BLOCK_EXTRACTION_DISTANCE * easedProgress)
      extractionGroup.position.copy(startPosition).add(offset)

      this.render()

      if (progress < 1) {
        this.removalAnimationFrameId = window.requestAnimationFrame(animateFrame)
        return
      }

      finish()
    }

    this.removalAnimationFrameId = window.requestAnimationFrame(animateFrame)
    return true
  }

  private resize() {
    const width = this.container.clientWidth || 640
    const height = this.container.clientHeight || 640
    const compactViewport = width <= 420 || window.innerWidth <= 640

    this.camera.position.set(0, 0, compactViewport ? COMPACT_CAMERA_RADIUS : DEFAULT_CAMERA_RADIUS)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.camera.lookAt(0, 0, 0)
    this.renderer.setSize(width, height, false)
  }

  private render() {
    this.renderer.render(this.scene, this.camera)
  }

  private cancelRemovalAnimation() {
    if (this.removalAnimationFrameId !== null) {
      window.cancelAnimationFrame(this.removalAnimationFrameId)
      this.removalAnimationFrameId = null
    }

    if (this.removalHoldTimeoutId !== null) {
      window.clearTimeout(this.removalHoldTimeoutId)
      this.removalHoldTimeoutId = null
    }

    this.removalStaggerTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
    this.removalStaggerTimeoutIds = []
  }

  private staggerOutExtractionBlocks(onComplete: () => void) {
    if (!this.extractionGroup) {
      onComplete()
      return
    }

    const blockGroups = this.extractionGroup.children.filter((child): child is THREE.Group => child instanceof THREE.Group)

    if (blockGroups.length === 0) {
      this.disposeExtractionGroup()
      this.render()
      onComplete()
      return
    }

    const orderedBlockGroups = [...blockGroups].sort(
      (a, b) => b.position.dot(this.extractionVector) - a.position.dot(this.extractionVector),
    )

    orderedBlockGroups.forEach((blockGroup, index) => {
      const timeoutId = window.setTimeout(() => {
        this.animateExtractionBlockShrink(blockGroup, () => {
          if (index === orderedBlockGroups.length - 1) {
            this.removalStaggerTimeoutIds = []
            this.disposeExtractionGroup()
            this.render()
            onComplete()
          }
        })
      }, index * BLOCK_EXTRACTION_STAGGER_MS)

      this.removalStaggerTimeoutIds.push(timeoutId)
    })
  }

  private animateExtractionBlockShrink(blockGroup: THREE.Group, onComplete: () => void) {
    const startScale = blockGroup.scale.clone()
    const startTime = performance.now()

    const animateFrame = (time: number) => {
      const progress = clamp((time - startTime) / BLOCK_EXTRACTION_SHRINK_MS, 0, 1)
      const easedProgress = easeInCubic(progress)
      blockGroup.scale.copy(startScale).multiplyScalar(1 - easedProgress)
      this.render()

      if (progress < 1) {
        this.removalAnimationFrameId = window.requestAnimationFrame(animateFrame)
        return
      }

      blockGroup.visible = false
      onComplete()
    }

    this.removalAnimationFrameId = window.requestAnimationFrame(animateFrame)
  }

  private disposeExtractionGroup() {
    if (!this.extractionGroup) {
      return
    }

    this.cubeRoot.remove(this.extractionGroup)
    this.extractionGroup.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) {
        return
      }

      object.geometry.dispose()
      const material = object.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else {
        material.dispose()
      }
    })
    this.extractionGroup = null
  }

  private applyYawRotation() {
    const clampedPitch = clamp(
      this.pitchRadians + this.dragPitchOffset,
      -MAX_PITCH_RADIANS,
      MAX_PITCH_RADIANS,
    )
    this.cubeRoot.rotation.set(clampedPitch, this.yawRadians + this.dragYawOffset, 0)
  }

  private rebuildFaces(cube: CubeState) {
    this.faceMeshes.forEach((mesh) => {
      this.cubeRoot.remove(mesh)
      mesh.geometry.dispose()
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else {
        material.dispose()
      }
    })

    this.faceMeshes = []
    this.faceMeshByKey.clear()

    for (const face of getExposedFaces(cube)) {
      const faceKey = createFaceKey(face.blockId, face.direction)
      const mesh = this.createFaceMesh(face.x, face.y, face.z, face.direction, face.letter, false)
      mesh.userData.faceKey = faceKey
      mesh.userData.blockId = face.blockId
      mesh.userData.letter = face.letter
      mesh.userData.direction = face.direction
      mesh.userData.selected = false
      mesh.userData.legalHint = false
      this.faceMeshes.push(mesh)
      this.faceMeshByKey.set(faceKey, mesh)
      this.cubeRoot.add(mesh)
    }
  }

  private updateFaceTextureStates(nextSelectedFaceKeys: Set<string>, nextLegalHintFaceKeys: Set<string>) {
    const changedKeys = new Set<string>()

    for (const key of this.selectedFaceKeys) {
      if (!nextSelectedFaceKeys.has(key)) {
        changedKeys.add(key)
      }
    }

    for (const key of nextSelectedFaceKeys) {
      if (!this.selectedFaceKeys.has(key)) {
        changedKeys.add(key)
      }
    }

    for (const key of this.legalHintFaceKeys) {
      if (!nextLegalHintFaceKeys.has(key)) {
        changedKeys.add(key)
      }
    }

    for (const key of nextLegalHintFaceKeys) {
      if (!this.legalHintFaceKeys.has(key)) {
        changedKeys.add(key)
      }
    }

    for (const key of changedKeys) {
      const mesh = this.faceMeshByKey.get(key)

      if (!mesh) {
        continue
      }

      const nextSelected = nextSelectedFaceKeys.has(key)
      const nextLegalHint = !nextSelected && nextLegalHintFaceKeys.has(key)
      const material = mesh.material as THREE.MeshBasicMaterial
      material.map = this.getLetterTexture(
        mesh.userData.letter as string,
        mesh.userData.direction as Direction,
        getFaceTextureState(nextSelected, nextLegalHint),
      )
      material.needsUpdate = true
      mesh.userData.selected = nextSelected
      mesh.userData.legalHint = nextLegalHint
    }

    this.selectedFaceKeys = nextSelectedFaceKeys
    this.legalHintFaceKeys = nextLegalHintFaceKeys
  }

  private createFaceMesh(
    x: number,
    y: number,
    z: number,
    direction: Direction,
    letter: string,
    selected: boolean,
  ): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(FACE_SIZE, FACE_SIZE)
    const material = new THREE.MeshBasicMaterial({
      map: this.getLetterTexture(letter, direction, selected ? 'selected' : 'normal'),
      transparent: false,
      side: THREE.FrontSide,
    })

    const mesh = new THREE.Mesh(geometry, material)
    const center = gridToWorld(x, y, z)
    const offset = directionOffset(direction)

    mesh.position.set(
      center.x + offset.x * SURFACE_OFFSET,
      center.y + offset.y * SURFACE_OFFSET,
      center.z + offset.z * SURFACE_OFFSET,
    )

    switch (direction) {
      case 'px':
        mesh.rotation.y = Math.PI / 2
        break
      case 'nx':
        mesh.rotation.y = -Math.PI / 2
        break
      case 'py':
        mesh.rotation.x = -Math.PI / 2
        break
      case 'ny':
        mesh.rotation.x = Math.PI / 2
        break
      case 'pz':
        break
      case 'nz':
        mesh.rotation.y = Math.PI
        break
    }

    return mesh
  }

  private getLetterTexture(letter: string, direction: Direction, textureState: FaceTextureState): THREE.CanvasTexture {
    const cacheKey = `${letter}:${direction}:${textureState}`
    const cachedTexture = this.textureCache.get(cacheKey)

    if (cachedTexture) {
      return cachedTexture
    }

    const texture = createLetterTexture(letter, direction, textureState)
    this.textureCache.set(cacheKey, texture)
    return texture
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return
    }

    if (event.cancelable) {
      event.preventDefault()
    }

    this.pointerStartX = event.clientX
    this.pointerStartY = event.clientY
    this.activePointerId = event.pointerId
    this.dragActive = false
    this.dragYawOffset = 0
    this.dragPitchOffset = 0
    this.renderer.domElement.setPointerCapture(event.pointerId)
  }

  private handlePointerMove = (event: PointerEvent) => {
    if (
      this.activePointerId !== event.pointerId ||
      this.pointerStartX === null ||
      this.pointerStartY === null
    ) {
      return
    }

    const deltaX = event.clientX - this.pointerStartX
    const deltaY = event.clientY - this.pointerStartY

    if (!this.dragActive && Math.hypot(deltaX, deltaY) > DRAG_DEADZONE_PX) {
      this.dragActive = true
    }

    if (!this.dragActive) {
      return
    }

    if (event.cancelable) {
      event.preventDefault()
    }

    this.dragYawOffset = deltaX * DRAG_RADIANS_PER_PIXEL
    this.dragPitchOffset = deltaY * DRAG_RADIANS_PER_PIXEL
    this.applyYawRotation()
    this.render()
  }

  private handlePointerUp = (event: PointerEvent) => {
    if (this.activePointerId !== event.pointerId) {
      return
    }

    if (event.cancelable) {
      event.preventDefault()
    }

    if (this.dragActive) {
      const nextYawRadians = this.yawRadians + this.dragYawOffset
      const nextPitchRadians = clamp(
        this.pitchRadians + this.dragPitchOffset,
        -MAX_PITCH_RADIANS,
        MAX_PITCH_RADIANS,
      )
      this.dragYawOffset = 0
      this.dragPitchOffset = 0
      this.dragActive = false
      this.pointerStartX = null
      this.pointerStartY = null
      this.activePointerId = null
      this.renderer.domElement.releasePointerCapture(event.pointerId)
      this.onYawChange(nextYawRadians, nextPitchRadians)
      return
    }

    this.pointerStartX = null
    this.pointerStartY = null
    this.activePointerId = null
    this.dragYawOffset = 0
    this.dragPitchOffset = 0
    this.pickFace(event.clientX, event.clientY)
    this.renderer.domElement.releasePointerCapture(event.pointerId)
  }

  private handlePointerCancel = (event: PointerEvent) => {
    if (this.activePointerId !== event.pointerId) {
      return
    }

    if (event.cancelable) {
      event.preventDefault()
    }

    this.pointerStartX = null
    this.pointerStartY = null
    this.activePointerId = null
    this.dragActive = false
    this.dragYawOffset = 0
    this.dragPitchOffset = 0
    this.applyYawRotation()
    this.render()
    this.renderer.domElement.releasePointerCapture(event.pointerId)
  }

  private pickFace(clientX: number, clientY: number): boolean {
    const bounds = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.faceMeshes, false)

    if (hits.length === 0) {
      return false
    }

    const firstHit = hits[0].object as THREE.Mesh
    const faceKey = firstHit.userData.faceKey as string | undefined

    if (faceKey) {
      this.onFaceSelect(faceKey)
      return true
    }

    return false
  }
}

export type CubeShareRenderOptions = {
  width: number
  height: number
  yawRadians: number
  pitchRadians: number
  selectedFaceKeys?: string[]
  cameraRadius?: number
}

export function renderCubeShareCanvas(cube: CubeState, options: CubeShareRenderOptions): HTMLCanvasElement {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(options.width, options.height, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(36, options.width / options.height, 0.1, 100)
  camera.up.set(0, 1, 0)
  camera.position.set(0, 0, options.cameraRadius ?? 8.5)
  camera.lookAt(0, 0, 0)

  const cubeRoot = new THREE.Group()
  cubeRoot.scale.setScalar(CUBE_RENDER_SCALE)
  cubeRoot.position.y = CUBE_VERTICAL_OFFSET
  cubeRoot.rotation.set(
    clamp(options.pitchRadians, -MAX_PITCH_RADIANS, MAX_PITCH_RADIANS),
    options.yawRadians,
    0,
  )
  scene.add(cubeRoot)

  const selectedFaceKeys = new Set(options.selectedFaceKeys ?? [])

  for (const face of getExposedFaces(cube)) {
    cubeRoot.add(
      createStandaloneFaceMesh(
        face.x,
        face.y,
        face.z,
        face.direction,
        face.letter,
        selectedFaceKeys.has(createFaceKey(face.blockId, face.direction)),
      ),
    )
  }

  renderer.render(scene, camera)

  const canvas = document.createElement('canvas')
  canvas.width = options.width
  canvas.height = options.height
  const context = canvas.getContext('2d')

  if (!context) {
    renderer.dispose()
    throw new Error('Unable to create cube share canvas')
  }

  context.drawImage(renderer.domElement, 0, 0)
  disposeObjectTree(cubeRoot)
  renderer.dispose()
  return canvas
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3
}

function easeInCubic(value: number): number {
  return value ** 3
}

function getFaceTextureState(selected: boolean, legalHint: boolean): FaceTextureState {
  if (selected) {
    return 'selected'
  }

  if (legalHint) {
    return 'legal'
  }

  return 'normal'
}

function gridToWorld(x: number, y: number, z: number) {
  const half = (CUBE_SIZE - 1) / 2
  return {
    x: (x - half) * CELL_SIZE,
    y: (y - half) * CELL_SIZE,
    z: (z - half) * CELL_SIZE,
  }
}

function gridToWorldVector(x: number, y: number, z: number): THREE.Vector3 {
  const point = gridToWorld(x, y, z)
  return new THREE.Vector3(point.x, point.y, point.z)
}

function blockPositionKey(block: Block): string {
  return `${block.x},${block.y},${block.z}`
}

function hasSelectedNeighbor(
  block: Block,
  direction: Direction,
  selectedBlocksByPosition: Map<string, Block>,
  selectedBlockIds: Set<string>,
): boolean {
  const offset = directionOffset(direction)
  const neighbor = selectedBlocksByPosition.get(
    `${block.x + offset.x},${block.y + offset.y},${block.z + offset.z}`,
  )

  return Boolean(neighbor && selectedBlockIds.has(neighbor.id))
}

function createStandaloneFaceMesh(
  x: number,
  y: number,
  z: number,
  direction: Direction,
  letter: string,
  selected: boolean,
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(FACE_SIZE, FACE_SIZE)
  const material = new THREE.MeshBasicMaterial({
    map: createLetterTexture(letter, direction, selected ? 'selected' : 'normal'),
    transparent: true,
    side: THREE.FrontSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  const center = gridToWorld(x, y, z)
  const offset = directionOffset(direction)

  mesh.position.set(
    center.x + offset.x * SURFACE_OFFSET,
    center.y + offset.y * SURFACE_OFFSET,
    center.z + offset.z * SURFACE_OFFSET,
  )

  switch (direction) {
    case 'px':
      mesh.rotation.y = Math.PI / 2
      break
    case 'nx':
      mesh.rotation.y = -Math.PI / 2
      break
    case 'py':
      mesh.rotation.x = -Math.PI / 2
      break
    case 'ny':
      mesh.rotation.x = Math.PI / 2
      break
    case 'pz':
      break
    case 'nz':
      mesh.rotation.y = Math.PI
      break
  }

  return mesh
}

function disposeObjectTree(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) {
      return
    }

    object.geometry.dispose()
    const material = object.material

    if (Array.isArray(material)) {
      material.forEach(disposeMaterial)
    } else {
      disposeMaterial(material)
    }
  })
}

function disposeMaterial(material: THREE.Material) {
  if ('map' in material && material.map instanceof THREE.Texture) {
    material.map.dispose()
  }

  material.dispose()
}

function directionOffset(direction: Direction) {
  switch (direction) {
    case 'px':
      return { x: 1, y: 0, z: 0 }
    case 'nx':
      return { x: -1, y: 0, z: 0 }
    case 'py':
      return { x: 0, y: 1, z: 0 }
    case 'ny':
      return { x: 0, y: -1, z: 0 }
    case 'pz':
      return { x: 0, y: 0, z: 1 }
    case 'nz':
      return { x: 0, y: 0, z: -1 }
  }
}

function createBlockBodyMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(BLOCK_BODY_SIZE, BLOCK_BODY_SIZE, BLOCK_BODY_SIZE)
  const material = new THREE.MeshBasicMaterial({
    color: '#dce6ef',
    side: THREE.FrontSide,
  })
  return new THREE.Mesh(geometry, material)
}

function createBlockEdgeMesh(): THREE.LineSegments {
  const boxGeometry = new THREE.BoxGeometry(BLOCK_BODY_SIZE + 0.006, BLOCK_BODY_SIZE + 0.006, BLOCK_BODY_SIZE + 0.006)
  const geometry = new THREE.EdgesGeometry(boxGeometry)
  boxGeometry.dispose()
  const material = new THREE.LineBasicMaterial({
    color: '#31424f',
    linewidth: 1,
  })
  return new THREE.LineSegments(geometry, material)
}

function createLetterTexture(letter: string, direction: Direction, textureState: FaceTextureState): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create canvas texture context')
  }

  if (textureState === 'selected') {
    context.fillStyle = '#ffe184'
    roundRect(context, 10, 10, 108, 108, 10)
    context.fill()

    context.strokeStyle = '#b88918'
    context.lineWidth = 4
    roundRect(context, 10, 10, 108, 108, 10)
    context.stroke()
  } else {
    context.fillStyle = faceColor(direction)
    context.fillRect(0, 0, 128, 128)

    context.strokeStyle = '#31424f'
    context.lineWidth = 8
    context.strokeRect(4, 4, 120, 120)

    if (textureState === 'legal') {
      context.fillStyle = 'rgba(63, 116, 255, 0.12)'
      roundRect(context, 12, 12, 104, 104, 10)
      context.fill()

      context.strokeStyle = '#3f74ff'
      context.lineWidth = 5
      roundRect(context, 12, 12, 104, 104, 10)
      context.stroke()
    }
  }

  context.fillStyle = '#16212a'
  context.font = `700 72px ${CUBE_LETTER_FONT_FAMILY}, Georgia, serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(letter, 64, 68)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function faceColor(direction: Direction): string {
  switch (direction) {
    case 'py':
      return '#f4efe2'
    case 'pz':
    case 'nz':
      return '#d7e4ef'
    case 'px':
    case 'nx':
      return '#e4dcc9'
    case 'ny':
      return '#d2d7dc'
  }
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}
