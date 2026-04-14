import './style.css'
import {
  buildFaceMap,
  canAppendFace,
  countRemainingBlocks,
  createCubeState,
  createSeededRandom,
  DIRECTIONS,
  getExposedFaces,
  removeSelectedBlocks,
  selectionToWord,
  type CubeState,
} from './cube'
import { CUBE_LETTER_FONT_FAMILY, CubeView } from './cubeView'
import { createWordData, enumerateWordOpportunities } from './cubeOpportunities'
import { loadDictionary, loadPopularDictionary } from './dictionary'
import { APP_VERSION } from './version'

type GameOverReason = 'cleared' | 'no_more_words'
type InteractionHintState = 'visible' | 'dismissing' | 'hidden'
type GameIdentity = {
  label: string
  seed: number
  dateKey: string | null
}
type DailyPuzzleManifestEntry = {
  seed: number
  label?: string
}
type DailyPuzzleManifest = {
  puzzles: Map<string, DailyPuzzleManifestEntry>
}
type ManifestPuzzleDebugEntry = {
  dateKey: string
  seed: number
  label: string
}
type StarterDebugWord = {
  word: string
  faceKeys: string[]
}
type StarterDebugState = {
  length: number
  words: StarterDebugWord[]
  index: number
}
type SavedDailyProgress = {
  version: 2
  seed: number
  label: string
  dateKey: string
  cube: CubeState
  score: number
  foundWords: Array<{ word: string; points: number | null }>
  scoreEvents: Array<{ label: string; points: number }>
  hintedWords: string[]
  hintUsedThisRun: boolean
  gameOverReason: GameOverReason | null
  interactionHintState: InteractionHintState
}

type AppState = {
  cube: CubeState
  selectedFaces: string[]
  dictionary: Set<string> | null
  popularDictionary: Set<string> | null
  dictionaryPrefixes: Set<string>
  popularPrefixes: Set<string>
  score: number
  foundWords: Array<{ word: string; points: number | null }>
  scoreEvents: Array<{ label: string; points: number }>
  yawRadians: number
  pitchRadians: number
  status: string
  loading: boolean
  gameOverReason: GameOverReason | null
  pendingGameOverReason: GameOverReason | null
  hintedWords: Set<string>
  hintUsedThisRun: boolean
  historySheetOpen: boolean
  resolvingTurn: boolean
  legalMoveHintFaces: string[]
  interactionHintState: InteractionHintState
  gameSeed: number
  gameLabel: string
  gameDateKey: string | null
  shareStatus: string | null
  starterDebug: StarterDebugState | null
  manifestDebugIndex: number
}

const CUBE_CLEAR_BONUS = 5
const LEGACY_GAME_ID_SEARCH_PARAM = 'seed'
const GAME_ID_MAX_VALUE = 0xffffffff
const DAILY_PUZZLE_MANIFEST_URL = `${import.meta.env.BASE_URL}daily-puzzles.json`
const DAILY_PROGRESS_STORAGE_PREFIX = 'word-cube:daily-progress:v1'
const DAILY_PUZZLE_TIME_ZONE = 'Europe/London'
const DAILY_PUZZLE_VERSION = 1
const SAVED_DAILY_PROGRESS_VERSION = 2
const DAILY_PUZZLE_REFRESH_INTERVAL_HOURS = 24
const DEBUG_TOOLS_ENABLED = import.meta.env.DEV
const GAME_OVER_OVERLAY_DELAY_BY_REASON: Record<GameOverReason, number> = {
  cleared: 1000,
  no_more_words: 1500,
}
const DAILY_COUNTDOWN_REFRESH_MS = 250
const SHARE_IMAGE_WIDTH = 1080
const SHARE_IMAGE_HEIGHT = 1350
const INTERACTION_HINT_DISMISS_DELAY_MS = 500
const INTERACTION_HINT_FADE_MS = 900

function getInitialGameIdentity(): GameIdentity {
  removeLegacyGameSeedFromUrl()
  return createDailyGameIdentity(new Date())
}

function createCubeForSeed(seed: number): CubeState {
  return createCubeState({
    random: createSeededRandom(seed),
  })
}

function createDailyGameIdentity(date: Date): GameIdentity {
  const dateKey = getDailyDateKey(date)

  return {
    label: formatDailyDateLabel(dateKey),
    seed: hashStringToSeed(`word-cube:daily:v${DAILY_PUZZLE_VERSION}:${dateKey}`),
    dateKey,
  }
}

async function loadDailyPuzzleManifest(): Promise<DailyPuzzleManifest | null> {
  try {
    const response = await fetch(DAILY_PUZZLE_MANIFEST_URL, {
      cache: 'no-cache',
    })

    if (!response.ok) {
      return null
    }

    return parseDailyPuzzleManifest(await response.json())
  } catch {
    return null
  }
}

function applyCuratedDailyPuzzle(manifest: DailyPuzzleManifest | null) {
  if (!manifest || state.gameDateKey === null) {
    return
  }

  const puzzle = manifest.puzzles.get(state.gameDateKey) ?? manifest.puzzles.get(state.gameDateKey.split('T')[0])

  if (!puzzle) {
    return
  }

  state.gameSeed = puzzle.seed
  state.gameLabel = puzzle.label ?? formatDailyDateLabel(state.gameDateKey)
  state.cube = createCubeForSeed(puzzle.seed)
}

function restoreDailyProgress() {
  const savedProgress = readSavedDailyProgress()

  if (!savedProgress) {
    return
  }

  state.cube = savedProgress.cube
  state.score = savedProgress.score
  state.foundWords = savedProgress.foundWords
  state.scoreEvents = savedProgress.scoreEvents
  state.hintedWords = new Set(savedProgress.hintedWords)
  state.hintUsedThisRun = savedProgress.hintUsedThisRun
  state.gameOverReason = savedProgress.gameOverReason
  state.pendingGameOverReason = null
  state.interactionHintState = savedProgress.interactionHintState
  state.selectedFaces = []
  clearLegalMoveHints()
}

function saveDailyProgress() {
  const storageKey = getDailyProgressStorageKey()
  const dateKey = state.gameDateKey

  if (!storageKey || !dateKey || state.loading) {
    return
  }

  const progress: SavedDailyProgress = {
    version: SAVED_DAILY_PROGRESS_VERSION,
    seed: state.gameSeed,
    label: state.gameLabel,
    dateKey,
    cube: state.cube,
    score: state.score,
    foundWords: state.foundWords,
    scoreEvents: state.scoreEvents,
    hintedWords: Array.from(state.hintedWords),
    hintUsedThisRun: state.hintUsedThisRun,
    gameOverReason: state.gameOverReason,
    interactionHintState: getSavedInteractionHintState(),
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(progress))
  } catch {
    // Local storage is a convenience; the daily puzzle should remain playable if it is unavailable.
  }
}

function readSavedDailyProgress(): SavedDailyProgress | null {
  const storageKey = getDailyProgressStorageKey()

  if (!storageKey) {
    return null
  }

  try {
    const rawProgress = window.localStorage.getItem(storageKey)

    if (!rawProgress) {
      return null
    }

    return parseSavedDailyProgress(JSON.parse(rawProgress))
  } catch {
    return null
  }
}

function parseSavedDailyProgress(value: unknown): SavedDailyProgress | null {
  if (!isRecord(value) || value.version !== SAVED_DAILY_PROGRESS_VERSION || state.gameDateKey === null) {
    return null
  }

  const seed = parseManifestSeed(value.seed)

  if (seed !== state.gameSeed || value.dateKey !== state.gameDateKey || typeof value.label !== 'string') {
    return null
  }

  if (!isCubeState(value.cube) || !isFoundWordList(value.foundWords) || !isScoreEventList(value.scoreEvents)) {
    return null
  }

  if (
    typeof value.score !== 'number' ||
    !Number.isInteger(value.score) ||
    value.score < 0 ||
    !Array.isArray(value.hintedWords) ||
    !value.hintedWords.every((word) => typeof word === 'string') ||
    typeof value.hintUsedThisRun !== 'boolean' ||
    !isGameOverReason(value.gameOverReason) ||
    !isInteractionHintState(value.interactionHintState)
  ) {
    return null
  }

  return {
    version: SAVED_DAILY_PROGRESS_VERSION,
    seed,
    label: value.label,
    dateKey: value.dateKey,
    cube: value.cube,
    score: value.score,
    foundWords: value.foundWords,
    scoreEvents: value.scoreEvents,
    hintedWords: value.hintedWords,
    hintUsedThisRun: value.hintUsedThisRun,
    gameOverReason: value.gameOverReason,
    interactionHintState: value.interactionHintState,
  }
}

function getDailyProgressStorageKey(): string | null {
  if (state.gameDateKey === null) {
    return null
  }

  return `${DAILY_PROGRESS_STORAGE_PREFIX}:${state.gameDateKey}:${seedToGameId(state.gameSeed)}`
}

function getSavedInteractionHintState(): InteractionHintState {
  if (state.foundWords.length > 0 || state.interactionHintState === 'dismissing') {
    return 'hidden'
  }

  return state.interactionHintState
}

function isCubeState(value: unknown): value is CubeState {
  if (!isRecord(value) || !Array.isArray(value.blocks)) {
    return false
  }

  return value.blocks.every((block) => {
    if (
      !isRecord(block) ||
      typeof block.id !== 'string' ||
      typeof block.x !== 'number' ||
      typeof block.y !== 'number' ||
      typeof block.z !== 'number' ||
      typeof block.removed !== 'boolean' ||
      !isRecord(block.letters)
    ) {
      return false
    }

    const letters = block.letters

    return DIRECTIONS.every((direction) => typeof letters[direction] === 'string')
  })
}

function isFoundWordList(value: unknown): value is Array<{ word: string; points: number | null }> {
  return Array.isArray(value) && value.every((entry) =>
    isRecord(entry) &&
    typeof entry.word === 'string' &&
    (entry.points === null || (typeof entry.points === 'number' && Number.isInteger(entry.points))),
  )
}

function isScoreEventList(value: unknown): value is Array<{ label: string; points: number }> {
  return Array.isArray(value) && value.every((entry) =>
    isRecord(entry) &&
    typeof entry.label === 'string' &&
    typeof entry.points === 'number' &&
    Number.isInteger(entry.points),
  )
}

function isGameOverReason(value: unknown): value is GameOverReason | null {
  return value === null || value === 'cleared' || value === 'no_more_words'
}

function isInteractionHintState(value: unknown): value is InteractionHintState {
  return value === 'visible' || value === 'dismissing' || value === 'hidden'
}

function parseDailyPuzzleManifest(value: unknown): DailyPuzzleManifest | null {
  if (!isRecord(value) || !isRecord(value.puzzles)) {
    return null
  }

  const puzzles = new Map<string, DailyPuzzleManifestEntry>()

  Object.entries(value.puzzles).forEach(([dateKey, entry]) => {
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2})?$/.test(dateKey) || !isRecord(entry)) {
      return
    }

    const seed = parseManifestSeed(entry.seed)

    if (seed === null) {
      return
    }

    puzzles.set(dateKey, {
      seed,
      label: typeof entry.label === 'string' && entry.label.trim().length > 0 ? entry.label.trim() : undefined,
    })
  })

  return { puzzles }
}

function parseManifestSeed(value: unknown): number | null {
  const seed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value.trim().toUpperCase().replace(/[^0-9A-Z]/g, ''), 36)
        : Number.NaN

  if (!Number.isInteger(seed) || seed < 0 || seed > GAME_ID_MAX_VALUE) {
    return null
  }

  return seed >>> 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function seedToGameId(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase().padStart(7, '0')
}

function createRandomSeed(): number {
  const seedValues = new Uint32Array(1)

  if (globalThis.crypto) {
    globalThis.crypto.getRandomValues(seedValues)
    return seedValues[0]
  }

  return Math.floor(Math.random() * (GAME_ID_MAX_VALUE + 1))
}

function getDailyDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DAILY_PUZZLE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'

  if (DAILY_PUZZLE_REFRESH_INTERVAL_HOURS >= 24) {
    return `${year}-${month}-${day}`
  }

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const slotHour = Math.floor(hour / DAILY_PUZZLE_REFRESH_INTERVAL_HOURS) * DAILY_PUZZLE_REFRESH_INTERVAL_HOURS

  return `${year}-${month}-${day}T${String(slotHour).padStart(2, '0')}`
}

function formatDailyDateLabel(dateKey: string): string {
  const [datePart, slotHour] = dateKey.split('T')
  const [year, month, day] = datePart.split('-')
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthIndex = Number(month) - 1
  const dateLabel = `${Number(day)} ${monthLabels[monthIndex] ?? month} ${year.slice(-2)}`

  if (slotHour === undefined || DAILY_PUZZLE_REFRESH_INTERVAL_HOURS >= 24) {
    return dateLabel
  }

  return `${dateLabel}, ${slotHour}:00`
}

function hashStringToSeed(value: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

function removeLegacyGameSeedFromUrl() {
  const url = new URL(window.location.href)

  if (!url.searchParams.has(LEGACY_GAME_ID_SEARCH_PARAM)) {
    return
  }

  url.searchParams.delete(LEGACY_GAME_ID_SEARCH_PARAM)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root not found')
}

const appRoot = app
const initialGameIdentity = getInitialGameIdentity()
const state: AppState = {
  cube: createCubeForSeed(initialGameIdentity.seed),
  selectedFaces: [],
  dictionary: null,
  popularDictionary: null,
  dictionaryPrefixes: new Set(),
  popularPrefixes: new Set(),
  score: 0,
  foundWords: [],
  scoreEvents: [],
  yawRadians: Math.PI / 4,
  pitchRadians: (22 * Math.PI) / 180,
  status: 'Loading dictionary…',
  loading: true,
  gameOverReason: null,
  pendingGameOverReason: null,
  hintedWords: new Set(),
  hintUsedThisRun: false,
  historySheetOpen: false,
  resolvingTurn: false,
  legalMoveHintFaces: [],
  interactionHintState: 'visible',
  gameSeed: initialGameIdentity.seed,
  gameLabel: initialGameIdentity.label,
  gameDateKey: initialGameIdentity.dateKey,
  shareStatus: null,
  starterDebug: null,
  manifestDebugIndex: -1,
}

let cubeView: CubeView | null = null
let activeDailyPuzzleManifest: DailyPuzzleManifest | null = null
let gameOverRevealTimeoutId: number | null = null
let interactionHintHideTimeoutId: number | null = null
let dailyCountdownIntervalId: number | null = null
void loadCubeLetterFont()

window.addEventListener('resize', handleViewportModeChange)

renderShell()
void bootstrap()

async function bootstrap() {
  try {
    const [dictionary, popularDictionary, dailyPuzzleManifest] = await Promise.all([
      loadDictionary(),
      loadPopularDictionary(),
      loadDailyPuzzleManifest(),
    ])
    activeDailyPuzzleManifest = dailyPuzzleManifest
    state.dictionary = dictionary
    state.popularDictionary = popularDictionary
    state.dictionaryPrefixes = buildPrefixes(state.dictionary)
    state.popularPrefixes = buildPrefixes(state.popularDictionary)
    applyCuratedDailyPuzzle(dailyPuzzleManifest)
    restoreDailyProgress()
    state.loading = false
    state.status = 'Select adjacent visible faces that share an edge.'
    updateGameOverState()
    saveDailyProgress()
    renderShell()
    renderCube()
  } catch (error) {
    state.loading = false
    state.status = error instanceof Error ? error.message : 'Unable to load the prototype.'
    renderShell()
  }
}

function renderShell() {
  updateViewportModeClasses()

  appRoot.innerHTML = `
    <main class="app-shell">
      <section class="panel header-panel">
        <div class="header-topline">
          <div class="title-lockup">
            <h1>WORD CUBE</h1>
            <span class="byline">by Tom Heaton</span>
          </div>
          ${renderDebugHeaderActions()}
        </div>
      </section>

      <section class="workspace">
        <section class="panel stage-panel">
          <div class="stage-stack">
            <div class="mobile-score-pill" aria-label="Score ${state.score}">
              <span class="mobile-score-label">Score</span>
              <strong class="mobile-score-value">${state.score}</strong>
            </div>
            <div class="stage" data-stage></div>
            ${renderInteractionHint()}
            ${renderGameOverOverlay()}
          </div>
          ${renderStarterDebugPanel()}
          ${renderStageControls()}
          <section class="mobile-history-preview" aria-label="Recent found words">${renderMobileHistoryPreview()}</section>
        </section>

        <aside class="panel sidebar">
          <div class="score-card">
            <p class="score-label">Score</p>
            <p class="score-value">${state.score}</p>
          </div>

          <section class="history-panel">
            <p class="history-label">Found Words</p>
            <div class="history-card">
              ${renderDesktopFoundWords()}
            </div>
          </section>

          ${renderSidebarHintButton()}
        </aside>
      </section>
      <footer class="build-footer">
        <span aria-label="Puzzle ${state.gameLabel}">${state.gameLabel}</span>
        <span aria-label="Build ${APP_VERSION}">Build ${APP_VERSION}</span>
        <span aria-label="Copyright 2026 Tom Heaton. All rights reserved.">&copy; 2026 Tom Heaton. All rights reserved.</span>
      </footer>
      ${renderHistorySheet()}
    </main>
  `

  document.body.classList.toggle('history-sheet-open', state.historySheetOpen)
  bindUi()
  syncDailyCountdownTimer()
}

function renderStageControls(): string {
  if (state.gameOverReason) {
    return ''
  }

  return `
    <div class="stage-controls">
      ${renderWordReadout()}

      <div class="controls-row">
        <button class="action" data-action="submit" ${submitDisabled() ? 'disabled' : ''}>
          Submit
        </button>
        <button
          class="action is-secondary is-clear"
          data-action="clear"
          aria-label="Clear selection"
          title="Clear selection"
          ${state.selectedFaces.length === 0 ? 'disabled' : ''}
        >
          ×
        </button>
      </div>

      <button class="action action-with-icon action-secondary tablet-landscape-hint" data-action="hint" ${controlsLocked() ? 'disabled' : ''}>
        <span class="action-icon" aria-hidden="true">${renderActionIcon('hint')}</span>
        <span class="action-label">Hint</span>
      </button>
    </div>
  `
}

function renderSidebarHintButton(): string {
  if (state.gameOverReason) {
    return ''
  }

  return `
    <button class="action rapid-action action-with-icon action-secondary sidebar-hint" data-action="hint" ${controlsLocked() ? 'disabled' : ''}>
      <span class="action-icon" aria-hidden="true">${renderActionIcon('hint')}</span>
      <span class="action-label">Hint</span>
    </button>
  `
}

function renderDebugHeaderActions(): string {
  if (!DEBUG_TOOLS_ENABLED) {
    return ''
  }

  return `
    <div class="header-meta">
      <div class="debug-actions">
        <button class="debug-link" data-action="rapid-solve" aria-label="Rapid solve" title="Rapid solve" ${controlsLocked() ? 'disabled' : ''}>
          ${renderActionIcon('rapid')}
        </button>
        <button class="debug-link" data-action="random-cube" aria-label="Random test cube" title="Random test cube" ${debugCubeChangeLocked() ? 'disabled' : ''}>
          ${renderActionIcon('random')}
        </button>
        <button class="debug-link" data-action="manifest-cube" aria-label="Load next manifest cube" title="Load next manifest cube" ${manifestDebugLocked() ? 'disabled' : ''}>
          ${renderActionIcon('manifest')}
        </button>
        <button class="debug-link ${state.starterDebug ? 'is-active' : ''}" data-action="toggle-starter-debug" aria-label="Show starter words" title="Show starter words" ${starterDebugLocked() ? 'disabled' : ''}>
          ${renderActionIcon('words')}
        </button>
      </div>
    </div>
  `
}

function handleViewportModeChange() {
  updateViewportModeClasses()
}

function updateViewportModeClasses() {
  const width = window.innerWidth
  const height = window.innerHeight
  const tabletLandscape =
    width >= 900 && width <= 1500 && height >= 600 && height <= 1100 && width > height
  const tabletPortrait =
    width >= 560 && width <= 1200 && height >= 900 && height <= 1600 && height > width

  document.body.classList.toggle('mode-tablet-landscape', tabletLandscape)
  document.body.classList.toggle('mode-tablet-portrait', tabletPortrait)
}

function bindUi() {
  bindButtons('[data-action="clear"]', () => {
    if (controlsLocked()) {
      return
    }

    state.selectedFaces = []
    updateLegalMoveHints()
    state.status = 'Selection cleared.'
    renderShell()
    renderCube()
  })

  bindButtons('[data-action="submit"]', () => {
    submitSelection()
  })

  bindButtons('[data-action="rapid-solve"]', () => {
    rapidSolve()
  })

  bindButtons('[data-action="random-cube"]', () => {
    loadRandomTestCube()
  })

  bindButtons('[data-action="manifest-cube"]', () => {
    loadNextManifestDebugCube()
  })

  bindButtons('[data-action="toggle-starter-debug"]', () => {
    toggleStarterDebug()
  })

  bindButtons('[data-action="starter-debug-close"]', () => {
    closeStarterDebug()
  })

  bindButtons('[data-action="starter-debug-prev"]', () => {
    stepStarterDebug(-1)
  })

  bindButtons('[data-action="starter-debug-next"]', () => {
    stepStarterDebug(1)
  })

  appRoot.querySelectorAll<HTMLButtonElement>('[data-starter-debug-length]').forEach((button) => {
    const length = Number(button.dataset.starterDebugLength)

    button.addEventListener('click', () => {
      if (Number.isInteger(length)) {
        setStarterDebugLength(length)
      }
    })
  })

  bindButtons('[data-action="hint"]', () => {
    applyHint()
  })

  bindButtons('[data-action="share-results"]', () => {
    void shareResults()
  })

  bindButtons('[data-action="open-history"]', () => {
    state.historySheetOpen = true
    renderShell()
    renderCube()
  })

  bindButtons('[data-action="close-history"]', () => {
    state.historySheetOpen = false
    renderShell()
    renderCube()
  })

  window.onkeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && state.historySheetOpen) {
      event.preventDefault()
      state.historySheetOpen = false
      renderShell()
      renderCube()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      submitSelection()
    }
  }
}

function bindButtons(selector: string, onClick: () => void) {
  appRoot.querySelectorAll<HTMLButtonElement>(selector).forEach((button) => {
    let lastPointerActivation = -1

    button.addEventListener('pointerup', (event) => {
      if (event.button !== 0 || button.disabled) {
        return
      }

      lastPointerActivation = event.timeStamp
      onClick()
    })

    button.addEventListener('click', (event) => {
      if (button.disabled) {
        return
      }

      // Touch browsers may synthesize a delayed click after pointerup.
      if (lastPointerActivation >= 0 && event.timeStamp - lastPointerActivation < 750) {
        return
      }

      onClick()
    })
  })
}

function renderCube() {
  const stage = appRoot.querySelector<HTMLElement>('[data-stage]')

  if (!stage) {
    return
  }

  if (!cubeView) {
    cubeView = new CubeView(stage, handleFaceSelect, handleYawChange)
  } else {
    cubeView.attachTo(stage)
  }

  cubeView.setState(
    state.cube,
    state.selectedFaces.length > 0 ? state.selectedFaces : getStarterDebugHighlightFaces(),
    state.yawRadians,
    state.pitchRadians,
    state.legalMoveHintFaces,
  )
}

async function loadCubeLetterFont() {
  if (!('fonts' in document)) {
    return
  }

  try {
    await document.fonts.load(`700 72px ${CUBE_LETTER_FONT_FAMILY}`)
    cubeView?.refreshLetterTextures()
  } catch {
    // Keep the fallback serif rendering if the web font cannot be loaded.
  }
}

function updateSelectionUi() {
  const wordReadout = appRoot.querySelector<HTMLElement>('.word-readout')
  if (wordReadout) {
    wordReadout.outerHTML = renderWordReadout()
  }

  appRoot.querySelectorAll<HTMLButtonElement>('[data-action="submit"]').forEach((button) => {
    button.disabled = submitDisabled()
  })

  appRoot.querySelectorAll<HTMLButtonElement>('[data-action="clear"]').forEach((button) => {
    button.disabled = state.selectedFaces.length === 0 || controlsLocked()
  })
}

function renderWordReadout(): string {
  const word = currentWord()
  const length = word.length
  const validWord = Boolean(state.dictionary && length >= 4 && state.dictionary.has(word))
  const classes = ['word-readout']

  if (length === 0) {
    classes.push('is-empty')
  }

  if (length > 0 && length < 4) {
    classes.push('is-short')
  }

  if (validWord) {
    classes.push('is-valid')
  }

  return `
    <div class="${classes.join(' ')}">
      <span class="word-readout-text">${word || '4+ letters'}</span>
    </div>
  `
}

function renderInteractionHint(): string {
  if (state.loading || state.gameOverReason || state.interactionHintState === 'hidden') {
    return ''
  }

  return `
    <p class="interaction-hint is-${state.interactionHintState}" data-interaction-hint>
      Tap letters. Make words. Drag to rotate.
    </p>
  `
}

function renderStarterDebugPanel(): string {
  if (!DEBUG_TOOLS_ENABLED || !state.starterDebug || state.gameOverReason) {
    return ''
  }

  const debug = state.starterDebug
  const current = getCurrentStarterDebugWord()

  return `
    <section class="starter-debug-panel" aria-label="Starter word debug">
      <div class="starter-debug-header">
        <p>Starter Debug</p>
        <button class="starter-debug-close" data-action="starter-debug-close" aria-label="Close starter debug">×</button>
      </div>
      <div class="starter-debug-toolbar" aria-label="Starter word length">
        ${[4, 5, 6, 7, 8, 9]
          .map(
            (length) =>
              `<button class="starter-debug-chip ${debug.length === length ? 'is-active' : ''}" data-starter-debug-length="${length}">${length}</button>`,
          )
          .join('')}
      </div>
      <div class="starter-debug-current">
        <button class="starter-debug-step" data-action="starter-debug-prev" ${debug.words.length === 0 ? 'disabled' : ''} aria-label="Previous starter word">‹</button>
        <div class="starter-debug-word">
          <span>${debug.words.length === 0 ? '0 / 0' : `${debug.index + 1} / ${debug.words.length}`}</span>
          <strong>${current?.word ?? `No ${debug.length}-letter starters`}</strong>
        </div>
        <button class="starter-debug-step" data-action="starter-debug-next" ${debug.words.length === 0 ? 'disabled' : ''} aria-label="Next starter word">›</button>
      </div>
    </section>
  `
}


function handleFaceSelect(faceKey: string) {
  if (controlsLocked()) {
    return
  }

  clearStarterDebug()

  const faceMap = buildFaceMap(getExposedFaces(state.cube))
  const existingIndex = state.selectedFaces.indexOf(faceKey)

  if (existingIndex >= 0) {
    state.selectedFaces = state.selectedFaces.slice(0, existingIndex)
    updateLegalMoveHints()
    state.status = 'Selection rewound.'
    updateSelectionUi()
    renderCube()
    return
  }

  if (!canAppendFace(state.selectedFaces, faceKey, faceMap, state.cube)) {
    updateLegalMoveHints()
    state.status =
      state.selectedFaces.length === 0
        ? 'Face is not selectable.'
        : 'Next face must touch the previous face.'
    renderCube()
    return
  }

  state.selectedFaces = [...state.selectedFaces, faceKey]
  updateLegalMoveHints()
  state.status = 'Face added.'
  updateSelectionUi()
  renderCube()
}

function submitSelection() {
  if (!state.dictionary || controlsLocked()) {
    return
  }

  const faceMap = buildFaceMap(getExposedFaces(state.cube))
  const word = selectionToWord(state.selectedFaces, faceMap)
  const hintedSelection = state.hintedWords.has(word)

  if (word.length < 4) {
    state.selectedFaces = []
    clearLegalMoveHints()
    state.status = 'Words must be at least 4 letters.'
    renderShell()
    renderCube()
    return
  }

  if (!state.dictionary.has(word)) {
    state.selectedFaces = []
    clearLegalMoveHints()
    state.status = `${word} is not in the dictionary.`
    renderShell()
    renderCube()
    return
  }

  const points = hintedSelection ? null : scoreWord(word)

  if (points !== null) {
    state.score += points
    state.scoreEvents = [{ label: word, points }, ...state.scoreEvents]
  }

  const selectedFaces = [...state.selectedFaces]
  const hasBlockExtraction = cubeView?.prepareBlockExtraction(selectedFaces) ?? false
  state.foundWords = [{ word, points }, ...state.foundWords]
  scheduleInteractionHintDismissal()
  state.cube = removeSelectedBlocks(state.cube, selectedFaces, faceMap)
  state.selectedFaces = []
  clearLegalMoveHints()
  state.resolvingTurn = true
  state.status =
    points === null
      ? `${word} accepted as a hint. No score awarded. Selected blocks removed.`
      : `${word} accepted for ${points} point${points === 1 ? '' : 's'}. Selected blocks removed.`
  renderShell()
  renderCube()

  const finishRemoval = () => {
    window.setTimeout(() => {
      updateGameOverState({ delayOverlay: true })
      state.resolvingTurn = false
      renderShell()
      renderCube()
    }, 0)
  }

  if (!hasBlockExtraction || !cubeView?.animatePreparedBlockExtraction(finishRemoval)) {
    finishRemoval()
  }
}

function currentWord(): string {
  const faceMap = buildFaceMap(getExposedFaces(state.cube))
  return selectionToWord(state.selectedFaces, faceMap)
}

function handleYawChange(yawRadians: number, pitchRadians = state.pitchRadians) {
  state.yawRadians = yawRadians
  state.pitchRadians = pitchRadians
  if (!state.gameOverReason && !state.pendingGameOverReason) {
    state.status = 'Selection preserved.'
  }
  renderCube()
}

function submitDisabled(): boolean {
  return state.loading || state.selectedFaces.length === 0 || controlsLocked()
}

function scoreWord(word: string): number {
  const adjustedLength = Math.max(1, word.length - 3)
  return (adjustedLength * (adjustedLength + 1)) / 2
}

function renderFoundWords(): string {
  if (state.foundWords.length === 0) {
    return ''
  }

  return state.foundWords
    .map(
      ({ word, points }) => `
        <div class="history-item">
          <span class="history-word">${word}</span>
          <span class="history-points">${points === null ? 'HINT' : `+${points}`}</span>
        </div>
      `,
    )
    .join('')
}

function renderDesktopFoundWords(): string {
  const minimumRows = 8
  const rows = state.foundWords.map(
    ({ word, points }) => `
      <div class="desktop-history-row">
        <span class="desktop-history-word">${word}</span>
        <span class="desktop-history-points">${points === null ? 'HINT' : `+${points}`}</span>
      </div>
    `,
  )

  while (rows.length < minimumRows) {
    rows.push('<div class="desktop-history-row is-empty" aria-hidden="true"></div>')
  }

  return `
    <div class="desktop-history-scroll">
      ${rows.join('')}
    </div>
  `
}

function renderMobileHistoryPreview(): string {
  const recentWords = state.foundWords.slice(0, 6)
  const remainingWordCount = Math.max(0, state.foundWords.length - recentWords.length)
  const hasWords = state.foundWords.length > 0

  return `
    <div class="mobile-history-header">
      <p class="mobile-history-title">Found words</p>
      <button
        class="action-link"
        data-action="open-history"
        aria-haspopup="dialog"
        aria-expanded="${state.historySheetOpen}"
        ${hasWords ? '' : 'disabled'}
      >
        View all
      </button>
    </div>
    <div class="mobile-history-cards">
      ${
        hasWords
          ? `
              ${recentWords
                .map(
                  ({ word, points }) => `
                    <div class="mobile-history-card">
                      <span class="mobile-history-word">${word}</span>
                      <span class="mobile-history-points">${points === null ? 'HINT' : `+${points}`}</span>
                    </div>
                  `,
                )
                .join('')}
              ${
                remainingWordCount > 0
                  ? `<div class="mobile-history-chip">+${remainingWordCount} more</div>`
                  : ''
              }
            `
          : ''
      }
    </div>
  `
}

function renderHistorySheet(): string {
  if (!state.historySheetOpen) {
    return ''
  }

  return `
    <div class="history-sheet" role="dialog" aria-modal="true" aria-labelledby="history-sheet-title">
      <button class="history-sheet-backdrop" data-action="close-history" aria-label="Close found words"></button>
      <section class="history-sheet-panel">
        <div class="history-sheet-handle" aria-hidden="true"></div>
        <div class="history-sheet-header">
          <div>
            <p class="history-label">Found Words</p>
            <p class="history-sheet-title" id="history-sheet-title">
              ${state.foundWords.length} word${state.foundWords.length === 1 ? '' : 's'} found
            </p>
          </div>
          <button
            class="action is-secondary history-sheet-close"
            data-action="close-history"
            aria-label="Close found words"
          >
            Close
          </button>
        </div>
        <div class="history-sheet-list">
          ${renderFoundWords()}
        </div>
      </section>
    </div>
  `
}

function renderActionIcon(kind: 'hint' | 'rapid' | 'random' | 'manifest' | 'words'): string {
  if (kind === 'hint') {
    return `
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 2.5a5.1 5.1 0 0 0-3.72 8.6c.62.66 1 1.42 1.13 2.27h5.18c.12-.85.5-1.61 1.12-2.27A5.1 5.1 0 0 0 10 2.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        <path d="M7.9 15.15h4.2M8.4 17.2h3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
    `
  }

  if (kind === 'random') {
    return `
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M4 5.6h1.7c1.3 0 2.3.55 3.1 1.66l2.4 3.46c.8 1.1 1.84 1.66 3.1 1.66H16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        <path d="m14.15 10.5 2.2 1.88-2.2 1.88M4 14.4h1.7c.92 0 1.72-.3 2.4-.9M11.64 6.56c.72-.64 1.6-.96 2.66-.96H16M14.15 3.72l2.2 1.88-2.2 1.88" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `
  }

  if (kind === 'manifest') {
    return `
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M5.2 3.8h9.6a1.7 1.7 0 0 1 1.7 1.7v9.3a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V5.5a1.7 1.7 0 0 1 1.7-1.7Z" stroke="currentColor" stroke-width="1.6"/>
        <path d="M6.2 2.8v2.4M13.8 2.8v2.4M3.8 7.4h12.4M7 10h.1M10 10h.1M13 10h.1M7 13h.1M10 13h.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    `
  }

  if (kind === 'words') {
    return `
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M4.4 5.1h11.2M4.4 10h11.2M4.4 14.9h7.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        <path d="M5.4 3.2 3.7 16.8M10.2 3.2 8.5 16.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".72"/>
      </svg>
    `
  }

  return `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M11.6 1.8 5.7 10h3.4l-1.1 8.2 6-8.8h-3.5l1.1-7.6Z" fill="currentColor"/>
    </svg>
  `
}

function buildPrefixes(words: Set<string>): Set<string> {
  const prefixes = new Set<string>()

  for (const word of words) {
    for (let index = 1; index < word.length; index += 1) {
      prefixes.add(word.slice(0, index))
    }
  }

  return prefixes
}

function selectionLocked(): boolean {
  return state.gameOverReason !== null || state.pendingGameOverReason !== null
}

function controlsLocked(): boolean {
  return state.loading || state.resolvingTurn || selectionLocked()
}

function debugCubeChangeLocked(): boolean {
  return state.loading || state.resolvingTurn
}

function manifestDebugLocked(): boolean {
  return debugCubeChangeLocked() || getManifestPuzzleDebugEntries().length === 0
}

function loadNextManifestDebugCube() {
  const entries = getManifestPuzzleDebugEntries()

  if (entries.length === 0 || debugCubeChangeLocked()) {
    state.status = 'No manifest cubes available.'
    renderShell()
    renderCube()
    return
  }

  const nextIndex = (state.manifestDebugIndex + 1 + entries.length) % entries.length
  const entry = entries[nextIndex]

  state.manifestDebugIndex = nextIndex
  resetGameForSeed(entry.seed, entry.label, null, `Manifest cube ${nextIndex + 1}/${entries.length}: ${entry.dateKey}.`)
}

function getManifestPuzzleDebugEntries(): ManifestPuzzleDebugEntry[] {
  if (!activeDailyPuzzleManifest) {
    return []
  }

  return [...activeDailyPuzzleManifest.puzzles.entries()]
    .sort(([dateKeyA], [dateKeyB]) => dateKeyA.localeCompare(dateKeyB))
    .map(([dateKey, puzzle]) => ({
      dateKey,
      seed: puzzle.seed,
      label: puzzle.label ?? formatDailyDateLabel(dateKey),
    }))
}

function starterDebugLocked(): boolean {
  return state.loading || !state.popularDictionary || state.resolvingTurn || selectionLocked()
}

function toggleStarterDebug() {
  if (state.starterDebug) {
    closeStarterDebug()
    return
  }

  setStarterDebugLength(5)
}

function closeStarterDebug() {
  if (!clearStarterDebug()) {
    return
  }

  renderShell()
  renderCube()
}

function clearStarterDebug(): boolean {
  if (!state.starterDebug) {
    return false
  }

  state.starterDebug = null
  return true
}

function setStarterDebugLength(length: number) {
  if (!state.popularDictionary || starterDebugLocked()) {
    return
  }

  const words = findStarterDebugWords(length)
  state.starterDebug = {
    length,
    words,
    index: 0,
  }
  state.status =
    words.length === 0
      ? `No visible ${length}-letter popular starter words.`
      : `Showing ${words.length} visible ${length}-letter popular starter word${words.length === 1 ? '' : 's'}.`
  renderShell()
  renderCube()
}

function stepStarterDebug(direction: -1 | 1) {
  if (!state.starterDebug || state.starterDebug.words.length === 0) {
    return
  }

  const debug = state.starterDebug
  debug.index = (debug.index + direction + debug.words.length) % debug.words.length
  const current = debug.words[debug.index]
  state.status = current ? `Starter debug: ${current.word}.` : 'Starter debug.'
  renderShell()
  renderCube()
}

function getCurrentStarterDebugWord(): StarterDebugWord | null {
  if (!state.starterDebug || state.starterDebug.words.length === 0) {
    return null
  }

  return state.starterDebug.words[state.starterDebug.index] ?? null
}

function getStarterDebugHighlightFaces(): string[] {
  return getCurrentStarterDebugWord()?.faceKeys ?? []
}

function findStarterDebugWords(length: number): StarterDebugWord[] {
  if (!state.popularDictionary) {
    return []
  }

  const wordData = createWordData(state.popularDictionary, length)
  const opportunities = enumerateWordOpportunities(state.cube, wordData, length, length)
  const byWord = new Map<string, StarterDebugWord>()

  for (const opportunity of opportunities) {
    if (byWord.has(opportunity.word)) {
      continue
    }

    byWord.set(opportunity.word, {
      word: opportunity.word,
      faceKeys: opportunity.faceKeys,
    })
  }

  return [...byWord.values()].sort((a, b) => a.word.localeCompare(b.word))
}

function clearLegalMoveHints(): boolean {
  if (state.legalMoveHintFaces.length === 0) {
    return false
  }

  state.legalMoveHintFaces = []
  return true
}

function updateLegalMoveHints(): boolean {
  if (state.selectedFaces.length === 0) {
    return clearLegalMoveHints()
  }

  const faceMap = buildFaceMap(getExposedFaces(state.cube))
  state.legalMoveHintFaces = Array.from(faceMap.keys()).filter((candidateKey) =>
    canAppendFace(state.selectedFaces, candidateKey, faceMap, state.cube),
  )
  return true
}

function scheduleInteractionHintDismissal() {
  if (state.interactionHintState !== 'visible') {
    return
  }

  state.interactionHintState = 'dismissing'

  if (interactionHintHideTimeoutId !== null) {
    window.clearTimeout(interactionHintHideTimeoutId)
  }

  interactionHintHideTimeoutId = window.setTimeout(() => {
    interactionHintHideTimeoutId = null
    state.interactionHintState = 'hidden'
    renderShell()
    renderCube()
  }, INTERACTION_HINT_DISMISS_DELAY_MS + INTERACTION_HINT_FADE_MS)
}

function resetInteractionHint() {
  if (interactionHintHideTimeoutId !== null) {
    window.clearTimeout(interactionHintHideTimeoutId)
    interactionHintHideTimeoutId = null
  }

  state.interactionHintState = 'visible'
}

function clearPendingGameOverReveal() {
  if (gameOverRevealTimeoutId !== null) {
    window.clearTimeout(gameOverRevealTimeoutId)
    gameOverRevealTimeoutId = null
  }

  state.pendingGameOverReason = null
}

function updateGameOverState(options: { delayOverlay?: boolean } = {}) {
  const { delayOverlay = false } = options
  const remainingBlocks = countRemainingBlocks(state.cube)
  let nextReason: GameOverReason | null = null

  if (remainingBlocks === 0) {
    awardCubeClearBonus()
    nextReason = 'cleared'
  } else if (state.dictionary && !findAnyLegalWord(state.cube, state.dictionary, state.dictionaryPrefixes)) {
    nextReason = 'no_more_words'
  }

  if (!nextReason) {
    clearPendingGameOverReveal()
    state.gameOverReason = null
    saveDailyProgress()
    return
  }

  state.status = nextReason === 'cleared' ? 'GAME OVER. Cube cleared.' : 'GAME OVER. No more words.'

  if (!delayOverlay) {
    clearPendingGameOverReveal()
    state.gameOverReason = nextReason
    saveDailyProgress()
    return
  }

  clearPendingGameOverReveal()
  state.gameOverReason = null
  state.pendingGameOverReason = nextReason
  saveDailyProgress()
  gameOverRevealTimeoutId = window.setTimeout(() => {
      state.pendingGameOverReason = null
      state.gameOverReason = nextReason
      gameOverRevealTimeoutId = null
      saveDailyProgress()
      renderShell()
      renderCube()
  }, GAME_OVER_OVERLAY_DELAY_BY_REASON[nextReason])
}

function findAnyLegalWord(
  cube: CubeState,
  dictionary: Set<string>,
  prefixes: Set<string>,
): { word: string; faceKeys: string[] } | null {
  const faces = getExposedFaces(cube)
  const faceMap = buildFaceMap(faces)

  for (const startFace of faces) {
    const result = search([startFace.key], startFace.letter)

    if (result) {
      return result
    }
  }

  return null

  function search(path: string[], currentWord: string): { word: string; faceKeys: string[] } | null {
    if (currentWord.length >= 4 && dictionary.has(currentWord)) {
      return {
        word: currentWord,
        faceKeys: [...path],
      }
    }

    if (!prefixes.has(currentWord)) {
      return null
    }

    for (const candidate of faces) {
      if (!canAppendFace(path, candidate.key, faceMap, cube)) {
        continue
      }

      const result = search([...path, candidate.key], currentWord + candidate.letter)

      if (result) {
        return result
      }
    }

    return null
  }
}

function renderGameOverOverlay(): string {
  if (!state.gameOverReason) {
    return ''
  }

  const longestWord = getLongestFoundWord()
  const visibleLongestWord = longestWord ?? 'None'
  const outcome = state.gameOverReason === 'cleared' ? 'Cube Cleared' : 'No words left'
  const cubeClearBonus = getCubeClearBonusPoints()

  return `
    <div class="game-over-overlay">
      <div class="game-over-results-stack">
        <section class="game-over-outcome-panel" aria-label="Result">
          <p>
            ${outcome}
            ${
              cubeClearBonus === null
                ? ''
                : `<span class="game-over-outcome-bonus">+${cubeClearBonus}</span>`
            }
          </p>
        </section>

        <section class="game-over-card" aria-label="Word Cube results">
          <p class="game-over-title">WORD CUBE</p>
          <p class="game-over-reason">${state.gameLabel}</p>
          <div class="game-over-stats-grid">
            <p class="game-over-stat"><span>Score</span><strong>${state.score}</strong></p>
            <p class="game-over-stat"><span>Words</span><strong>${state.foundWords.length}</strong></p>
          </div>
          <p class="game-over-stat game-over-longest"><span>Longest</span><strong>${visibleLongestWord}</strong></p>
          <button class="action game-over-action" data-action="share-results">${state.shareStatus ?? 'Share'}</button>
        </section>

        ${
          state.gameDateKey === null
            ? ''
            : `
              <section class="game-over-countdown-panel" aria-label="Next cube">
                <p data-daily-countdown>${renderDailyCountdownText()}</p>
              </section>
            `
        }
      </div>
    </div>
  `
}

async function shareResults() {
  if (!state.gameOverReason) {
    return
  }

  const shareText = createResultsShareText()
  const shareUrl = getShareUrl()
  const imageBlob = await createResultsShareImageBlob()
  const imageFile = new File([imageBlob], 'word-cube-results.png', { type: imageBlob.type })
  const shareNavigator = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean
    share?: (data: ShareData) => Promise<void>
  }
  const textShareData: ShareData = {
    title: 'Word Cube',
    text: shareText,
    url: shareUrl,
  }
  const nativeShareTarget = shouldUseNativeShare()

  if (nativeShareTarget) {
    if (typeof shareNavigator.share !== 'function') {
      state.shareStatus = 'Share unavailable'
      renderShell()
      renderCube()
      return
    }

    const imageShareData: ShareData = {
      files: [imageFile],
    }

    try {
      if (!shareNavigator.canShare || shareNavigator.canShare(imageShareData)) {
        await shareNavigator.share(imageShareData)
        state.shareStatus = 'Shared'
        renderShell()
        renderCube()
        return
      }

      await shareNavigator.share(textShareData)
      state.shareStatus = 'Shared'
      renderShell()
      renderCube()
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      try {
        await shareNavigator.share(textShareData)
        state.shareStatus = 'Shared'
        renderShell()
        renderCube()
        return
      } catch (fallbackError) {
        if (fallbackError instanceof DOMException && fallbackError.name === 'AbortError') {
          return
        }

        state.shareStatus = 'Share unavailable'
        renderShell()
        renderCube()
        return
      }
    }
  }

  if (await copyImageToClipboard(imageBlob)) {
    state.shareStatus = 'Copied to Clipboard'
  } else if (navigator.clipboard) {
    await navigator.clipboard.writeText(`${shareText}\n\nWord Cube\n${shareUrl}`)
    state.shareStatus = 'Copied to Clipboard'
  } else {
    downloadShareImage(imageBlob)
    state.shareStatus = 'Downloaded image'
  }


  renderShell()
  renderCube()
}

async function copyImageToClipboard(imageBlob: Blob): Promise<boolean> {
  if (!navigator.clipboard || !('write' in navigator.clipboard) || typeof ClipboardItem === 'undefined') {
    return false
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        [imageBlob.type]: imageBlob,
      }),
    ])
    return true
  } catch {
    return false
  }
}

function downloadShareImage(imageBlob: Blob) {
  const downloadUrl = URL.createObjectURL(imageBlob)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = 'word-cube-results.png'
  link.click()
  URL.revokeObjectURL(downloadUrl)
}

async function createResultsShareImageBlob(): Promise<Blob> {
  if ('fonts' in document) {
    await document.fonts.ready
  }

  const canvas = document.createElement('canvas')
  canvas.width = SHARE_IMAGE_WIDTH
  canvas.height = SHARE_IMAGE_HEIGHT
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create share image context')
  }

  const maskedLongestWord = maskWord(getLongestFoundWord())
  const backgroundGradient = context.createLinearGradient(0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT)
  backgroundGradient.addColorStop(0, '#eef5ff')
  backgroundGradient.addColorStop(0.55, '#f8fbff')
  backgroundGradient.addColorStop(1, '#e4edf9')

  context.fillStyle = backgroundGradient
  context.fillRect(0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT)
  drawShareGlow(context, 180, 150, 300, 'rgba(63, 116, 255, 0.16)')
  drawShareGlow(context, 880, 1120, 380, 'rgba(245, 218, 112, 0.18)')

  context.save()
  context.shadowColor = 'rgba(23, 39, 72, 0.16)'
  context.shadowBlur = 48
  context.shadowOffsetY = 28
  fillRoundedRect(context, 82, 112, 916, 1076, 64, 'rgba(255, 255, 255, 0.94)')
  context.restore()
  strokeRoundedRect(context, 82, 112, 916, 1076, 64, 'rgba(113, 135, 171, 0.28)', 3)

  drawTrackedText(context, 'WORD CUBE', SHARE_IMAGE_WIDTH / 2, 240, 72, 7, '#13203b', 'center')

  context.font = "700 34px Manrope, 'Segoe UI', sans-serif"
  context.fillStyle = '#70809b'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(state.gameLabel, SHARE_IMAGE_WIDTH / 2, 310)

  fillRoundedRect(context, 166, 410, 340, 244, 42, '#f8fbff')
  fillRoundedRect(context, 574, 410, 340, 244, 42, '#f8fbff')
  strokeRoundedRect(context, 166, 410, 340, 244, 42, 'rgba(138, 157, 189, 0.24)', 2)
  strokeRoundedRect(context, 574, 410, 340, 244, 42, 'rgba(138, 157, 189, 0.24)', 2)
  drawShareStat(context, 'Score', String(state.score), 336, 530, 86)
  drawShareStat(context, 'Words', String(state.foundWords.length), 744, 530, 86)

  fillRoundedRect(context, 166, 718, 748, 220, 42, '#f8fbff')
  strokeRoundedRect(context, 166, 718, 748, 220, 42, 'rgba(138, 157, 189, 0.24)', 2)
  drawShareStat(context, 'Longest', maskedLongestWord, SHARE_IMAGE_WIDTH / 2, 832, getShareLongestFontSize(maskedLongestWord))

  context.font = "700 27px Manrope, 'Segoe UI', sans-serif"
  context.fillStyle = '#70809b'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('inonedaygames.github.io/WordCube', SHARE_IMAGE_WIDTH / 2, 1072)

  return canvasToPngBlob(canvas)
}

function drawShareStat(
  context: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  valueBaseline: number,
  valueFontSize: number,
) {
  drawTrackedText(context, label.toUpperCase(), x, valueBaseline - valueFontSize / 2 - 38, 25, 4, '#6b7a95', 'center')
  context.font = `800 ${valueFontSize}px Manrope, 'Segoe UI', sans-serif`
  context.fillStyle = '#14213b'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(value, x, valueBaseline)
}

function getShareLongestFontSize(maskedLongestWord: string): number {
  if (maskedLongestWord.length > 12) {
    return 50
  }

  if (maskedLongestWord.length > 9) {
    return 62
  }

  return 76
}

function drawShareGlow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
}

function drawTrackedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  tracking: number,
  color: string,
  align: CanvasTextAlign,
) {
  context.font = `800 ${fontSize}px Manrope, 'Segoe UI', sans-serif`
  context.fillStyle = color
  context.textBaseline = 'middle'

  const widths = text.split('').map((character) => context.measureText(character).width)
  const textWidth = widths.reduce((sum, width) => sum + width, 0) + tracking * Math.max(0, text.length - 1)
  let cursor = align === 'center' ? x - textWidth / 2 : x

  context.textAlign = 'left'
  text.split('').forEach((character, index) => {
    context.fillText(character, cursor, y)
    cursor += widths[index] + tracking
  })
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string | CanvasGradient,
) {
  addRoundedRectPath(context, x, y, width, height, radius)
  context.fillStyle = fillStyle
  context.fill()
}

function strokeRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  strokeStyle: string,
  lineWidth: number,
) {
  addRoundedRectPath(context, x, y, width, height, radius)
  context.strokeStyle = strokeStyle
  context.lineWidth = lineWidth
  context.stroke()
}

function addRoundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const constrainedRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + constrainedRadius, y)
  context.lineTo(x + width - constrainedRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + constrainedRadius)
  context.lineTo(x + width, y + height - constrainedRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - constrainedRadius, y + height)
  context.lineTo(x + constrainedRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - constrainedRadius)
  context.lineTo(x, y + constrainedRadius)
  context.quadraticCurveTo(x, y, x + constrainedRadius, y)
  context.closePath()
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }

      reject(new Error('Unable to create share image'))
    }, 'image/png')
  })
}

function shouldUseNativeShare(): boolean {
  const navigatorWithUserAgentData = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  const userAgent = navigator.userAgent

  if (navigatorWithUserAgentData.userAgentData?.mobile) {
    return true
  }

  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) {
    return true
  }

  if (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1) {
    return true
  }

  return window.matchMedia('(any-pointer: coarse)').matches && window.innerWidth <= 1500
}

function createResultsShareText(): string {
  const longestWord = maskWord(getLongestFoundWord())

  return [
    'WORD CUBE',
    state.gameLabel,
    '',
    `Score: ${state.score}`,
    `Words: ${state.foundWords.length}`,
    `Longest: ${longestWord}`,
  ].join('\n')
}

function getShareUrl(): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.href)
  url.search = ''
  url.hash = ''
  return url.href
}

function maskWord(word: string | null): string {
  if (!word) {
    return 'None'
  }

  const letters = word.toUpperCase().split('')
  const revealIndexes =
    letters.length >= 8
      ? new Set([Math.floor(letters.length / 3), Math.floor((letters.length * 2) / 3)])
      : new Set([Math.floor(letters.length / 2)])

  return letters.map((letter, index) => (revealIndexes.has(index) ? letter : '*')).join('')
}

function renderDailyCountdownText(): string {
  const remainingMilliseconds = getMillisecondsUntilNextDailyCube()

  if (remainingMilliseconds <= 0) {
    return 'New cube available'
  }

  return `New cube in ${formatCountdownDuration(remainingMilliseconds)}`
}

function syncDailyCountdownTimer() {
  const countdown = appRoot.querySelector<HTMLElement>('[data-daily-countdown]')

  if (!countdown) {
    stopDailyCountdownTimer()
    return
  }

  countdown.textContent = renderDailyCountdownText()

  if (dailyCountdownIntervalId !== null) {
    return
  }

  dailyCountdownIntervalId = window.setInterval(() => {
    const activeCountdown = appRoot.querySelector<HTMLElement>('[data-daily-countdown]')

    if (!activeCountdown) {
      stopDailyCountdownTimer()
      return
    }

    activeCountdown.textContent = renderDailyCountdownText()
  }, DAILY_COUNTDOWN_REFRESH_MS)
}

function stopDailyCountdownTimer() {
  if (dailyCountdownIntervalId === null) {
    return
  }

  window.clearInterval(dailyCountdownIntervalId)
  dailyCountdownIntervalId = null
}

function getMillisecondsUntilNextDailyCube(now = new Date()): number {
  const currentDateKey = getDailyDateKey(now)

  if (state.gameDateKey !== null && currentDateKey > state.gameDateKey) {
    return 0
  }

  let low = now.getTime()
  let high = low + 48 * 60 * 60 * 1000

  while (getDailyDateKey(new Date(high)) === currentDateKey) {
    high += 24 * 60 * 60 * 1000
  }

  while (high - low > 1000) {
    const mid = Math.floor((low + high) / 2)

    if (getDailyDateKey(new Date(mid)) === currentDateKey) {
      low = mid
    } else {
      high = mid
    }
  }

  return Math.max(0, high - now.getTime())
}

function formatCountdownDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function getLongestFoundWord(): string | null {
  let longestWord: string | null = null

  for (const { word } of [...state.foundWords].reverse()) {
    if (!longestWord || word.length > longestWord.length) {
      longestWord = word
    }
  }

  return longestWord
}

function awardCubeClearBonus() {
  if (state.hintUsedThisRun) {
    return
  }

  if (getCubeClearBonusPoints() !== null) {
    return
  }

  state.score += CUBE_CLEAR_BONUS
  state.scoreEvents = [{ label: 'Cube cleared', points: CUBE_CLEAR_BONUS }, ...state.scoreEvents]
}

function getCubeClearBonusPoints(): number | null {
  return state.scoreEvents.find(({ label }) => label === 'Cube cleared')?.points ?? null
}

function rapidSolve() {
  if (!state.dictionary || controlsLocked()) {
    return
  }

  state.selectedFaces = []
  clearLegalMoveHints()

  let safety = 0

  while (safety < 500) {
    safety += 1

    const result = findAnyLegalWord(state.cube, state.dictionary, state.dictionaryPrefixes)

    if (!result) {
      updateGameOverState()
      state.status = state.gameOverReason === 'cleared' ? 'GAME OVER. Cube cleared.' : 'GAME OVER. No more words.'
      renderShell()
      renderCube()
      return
    }

    const faceMap = buildFaceMap(getExposedFaces(state.cube))
    const points = scoreWord(result.word)
    state.score += points
    state.foundWords = [{ word: result.word, points }, ...state.foundWords]
    state.scoreEvents = [{ label: result.word, points }, ...state.scoreEvents]
    state.cube = removeSelectedBlocks(state.cube, result.faceKeys, faceMap)
    updateGameOverState()

    if (state.gameOverReason) {
      state.status =
        state.gameOverReason === 'cleared'
          ? `GAME OVER. Cube cleared after ${result.word}.`
          : `GAME OVER. No more words after ${result.word}.`
      renderShell()
      renderCube()
      return
    }
  }

  state.status = 'Rapid solve stopped early.'
  renderShell()
  renderCube()
}

function loadRandomTestCube() {
  if (debugCubeChangeLocked()) {
    return
  }

  const seed = createRandomSeed()
  resetGameForSeed(seed, `Test ${seedToGameId(seed)}`, null, 'Random test cube loaded.')
}

function resetGameForSeed(seed: number, label: string, dateKey: string | null, status: string) {
  clearPendingGameOverReveal()
  resetInteractionHint()
  state.gameSeed = seed
  state.gameLabel = label
  state.gameDateKey = dateKey
  state.cube = createCubeForSeed(seed)
  state.selectedFaces = []
  clearLegalMoveHints()
  state.score = 0
  state.foundWords = []
  state.scoreEvents = []
  state.gameOverReason = null
  state.pendingGameOverReason = null
  state.hintedWords = new Set()
  state.hintUsedThisRun = false
  state.historySheetOpen = false
  state.resolvingTurn = false
  state.legalMoveHintFaces = []
  state.shareStatus = null
  state.starterDebug = null
  state.status = status
  saveDailyProgress()
  renderShell()
  renderCube()
}

function applyHint() {
  if (!state.dictionary || !state.popularDictionary || controlsLocked()) {
    return
  }

  const hint =
    findShortestLegalWord(state.cube, state.popularDictionary, state.popularPrefixes) ??
    findShortestLegalWord(state.cube, state.dictionary, state.dictionaryPrefixes)

  if (!hint) {
    updateGameOverState()
    state.status = 'No hint available.'
    saveDailyProgress()
    renderShell()
    renderCube()
    return
  }

  state.selectedFaces = hint.faceKeys
  updateLegalMoveHints()
  state.hintedWords.add(hint.word)
  state.hintUsedThisRun = true
  state.status = `Hint: ${hint.word}`
  saveDailyProgress()
  renderShell()
  renderCube()
}

function findShortestLegalWord(
  cube: CubeState,
  dictionary: Set<string>,
  prefixes: Set<string>,
): { word: string; faceKeys: string[] } | null {
  const faces = getExposedFaces(cube)
  const faceMap = buildFaceMap(faces)
  const queue = faces.map((face) => ({
    path: [face.key],
    word: face.letter,
  }))

  while (queue.length > 0) {
    const current = queue.shift()

    if (!current) {
      break
    }

    if (current.word.length >= 4 && dictionary.has(current.word)) {
      return {
        word: current.word,
        faceKeys: current.path,
      }
    }

    if (!prefixes.has(current.word)) {
      continue
    }

    for (const candidate of faces) {
      if (!canAppendFace(current.path, candidate.key, faceMap, cube)) {
        continue
      }

      queue.push({
        path: [...current.path, candidate.key],
        word: current.word + candidate.letter,
      })
    }
  }

  return null
}
