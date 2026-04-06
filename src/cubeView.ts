import * as THREE from 'three'
import { CUBE_SIZE, DIRECTIONS, createFaceKey, type CubeState, type Direction } from './cube'

const CELL_SIZE = 1
const FACE_SIZE = 0.92
const SURFACE_OFFSET = 0.505
const CUBE_RENDER_SCALE = 1
const CUBE_VERTICAL_OFFSET = 0.0
const DRAG_DEADZONE_PX = 10
const DRAG_RADIANS_PER_PIXEL = 0.006
const MAX_PITCH_RADIANS = Math.PI / 4

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
  private faceMeshes: THREE.Mesh[] = []
  private yawRadians = 0
  private pitchRadians = 0
  private readonly cameraRadius = 12
  private dragYawOffset = 0
  private dragPitchOffset = 0
  private pointerStartX: number | null = null
  private pointerStartY: number | null = null
  private activePointerId: number | null = null
  private dragActive = false

  constructor(
    container: HTMLElement,
    onFaceSelect: (faceKey: string) => void,
    onYawChange: (yawRadians: number, pitchRadians: number) => void,
  ) {
    this.container = container
    this.onFaceSelect = onFaceSelect
    this.onYawChange = onYawChange
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
    this.camera.up.set(0, 1, 0)
    this.camera.position.set(0, 0, this.cameraRadius)
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

  setState(cube: CubeState, selectedFaceKeys: string[], yawRadians: number, pitchRadians: number) {
    this.yawRadians = yawRadians
    this.pitchRadians = pitchRadians
    this.applyYawRotation()
    this.rebuildFaces(cube, new Set(selectedFaceKeys))
    this.render()
  }

  destroy() {
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerCancel)
    this.resizeObserver.disconnect()
    this.renderer.dispose()
  }

  private resize() {
    const width = this.container.clientWidth || 640
    const height = this.container.clientHeight || 640
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private render() {
    this.renderer.render(this.scene, this.camera)
  }

  private applyYawRotation() {
    const clampedPitch = clamp(
      this.pitchRadians + this.dragPitchOffset,
      -MAX_PITCH_RADIANS,
      MAX_PITCH_RADIANS,
    )
    this.cubeRoot.rotation.set(clampedPitch, this.yawRadians + this.dragYawOffset, 0)
  }

  private rebuildFaces(cube: CubeState, selectedFaceKeys: Set<string>) {
    this.faceMeshes.forEach((mesh) => {
      this.cubeRoot.remove(mesh)
      mesh.geometry.dispose()
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else {
        const texturedMaterial = material as THREE.MeshBasicMaterial
        texturedMaterial.map?.dispose()
        material.dispose()
      }
    })

    this.faceMeshes = []

    for (const block of cube.blocks) {
      if (block.removed) {
        continue
      }

      for (const direction of DIRECTIONS) {
        const faceKey = createFaceKey(block.id, direction)
        const mesh = this.createFaceMesh(
          block.x,
          block.y,
          block.z,
          direction,
          block.letters[direction],
          selectedFaceKeys.has(faceKey),
        )
        mesh.userData.faceKey = faceKey
        this.faceMeshes.push(mesh)
        this.cubeRoot.add(mesh)
      }
    }
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
      map: createLetterTexture(letter, direction, selected),
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

  private handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return
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

    this.dragYawOffset = deltaX * DRAG_RADIANS_PER_PIXEL
    this.dragPitchOffset = deltaY * DRAG_RADIANS_PER_PIXEL
    this.applyYawRotation()
    this.render()
  }

  private handlePointerUp = (event: PointerEvent) => {
    if (this.activePointerId !== event.pointerId) {
      return
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

  private pickFace(clientX: number, clientY: number) {
    const bounds = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.faceMeshes, false)

    if (hits.length === 0) {
      return
    }

    const firstHit = hits[0].object as THREE.Mesh
    const faceKey = firstHit.userData.faceKey as string | undefined

    if (faceKey) {
      this.onFaceSelect(faceKey)
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function gridToWorld(x: number, y: number, z: number) {
  const half = (CUBE_SIZE - 1) / 2
  return {
    x: (x - half) * CELL_SIZE,
    y: (y - half) * CELL_SIZE,
    z: (z - half) * CELL_SIZE,
  }
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

function createLetterTexture(letter: string, direction: Direction, selected: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create canvas texture context')
  }

  context.fillStyle = selected ? '#f4d35e' : faceColor(direction)
  context.fillRect(0, 0, 128, 128)

  context.strokeStyle = selected ? '#946c00' : '#31424f'
  context.lineWidth = 8
  context.strokeRect(4, 4, 120, 120)

  context.fillStyle = '#16212a'
  context.font = '700 72px Georgia'
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
