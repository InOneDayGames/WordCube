import './style.css'
import {
  buildFaceMap,
  canAppendFace,
  countRemainingBlocks,
  createCubeState,
  getExposedFaces,
  removeSelectedBlocks,
  selectionToWord,
  type CubeState,
} from './cube'
import { CubeView } from './cubeView'
import { loadDictionary, loadPopularDictionary } from './dictionary'
import { APP_VERSION } from './version'

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
  gameOverReason: 'cleared' | 'no_more_words' | null
  hintedWords: Set<string>
  hintUsedThisRun: boolean
  historySheetOpen: boolean
}

const CUBE_CLEAR_BONUS = 3

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root not found')
}

const appRoot = app
const state: AppState = {
  cube: createCubeState(),
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
  hintedWords: new Set(),
  hintUsedThisRun: false,
  historySheetOpen: false,
}

let cubeView: CubeView | null = null

window.addEventListener('resize', handleViewportModeChange)

renderShell()
void bootstrap()

async function bootstrap() {
  try {
    const [dictionary, popularDictionary] = await Promise.all([loadDictionary(), loadPopularDictionary()])
    state.dictionary = dictionary
    state.popularDictionary = popularDictionary
    state.dictionaryPrefixes = buildPrefixes(state.dictionary)
    state.popularPrefixes = buildPrefixes(state.popularDictionary)
    state.loading = false
    state.status = 'Select adjacent visible faces that share an edge.'
    updateGameOverState()
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
          <div class="header-meta">
            <p class="build-version" aria-label="Build ${APP_VERSION}">Build ${APP_VERSION}</p>
            <button class="debug-link" data-action="rapid-solve" ${state.loading || state.gameOverReason ? 'disabled' : ''}>
              Rapid solve
            </button>
          </div>
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
            ${renderGameOverOverlay()}
          </div>
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

            <button class="action action-with-icon action-secondary tablet-landscape-hint" data-action="hint" ${state.loading || state.gameOverReason ? 'disabled' : ''}>
              <span class="action-icon" aria-hidden="true">${renderActionIcon('hint')}</span>
              <span class="action-label">Hint</span>
            </button>
          </div>
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

          <button class="action rapid-action action-with-icon action-secondary sidebar-hint" data-action="hint" ${state.loading || state.gameOverReason ? 'disabled' : ''}>
            <span class="action-icon" aria-hidden="true">${renderActionIcon('hint')}</span>
            <span class="action-label">Hint</span>
          </button>
        </aside>
      </section>
      ${renderHistorySheet()}
    </main>
  `

  document.body.classList.toggle('history-sheet-open', state.historySheetOpen)
  bindUi()
}

function handleViewportModeChange() {
  updateViewportModeClasses()
}

function updateViewportModeClasses() {
  const width = window.innerWidth
  const height = window.innerHeight
  const tabletLandscape =
    width >= 900 && width <= 1500 && height >= 600 && height <= 1100 && width > height

  document.body.classList.toggle('mode-tablet-landscape', tabletLandscape)
}

function bindUi() {
  bindButtons('[data-action="clear"]', () => {
    if (state.gameOverReason) {
      return
    }

    state.selectedFaces = []
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

  bindButtons('[data-action="hint"]', () => {
    applyHint()
  })

  bindButtons('[data-action="replay"]', () => {
    replayGame()
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
    button.addEventListener('click', onClick)
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

  cubeView.setState(state.cube, state.selectedFaces, state.yawRadians, state.pitchRadians)
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
    button.disabled = state.selectedFaces.length === 0
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


function handleFaceSelect(faceKey: string) {
  if (state.gameOverReason) {
    return
  }

  const faceMap = buildFaceMap(getExposedFaces(state.cube))

  if (!canAppendFace(state.selectedFaces, faceKey, faceMap, state.cube)) {
    state.status =
      state.selectedFaces.length === 0
        ? 'Face is not selectable.'
        : 'Next face must share a common edge with the previous face.'
    renderCube()
    return
  }

  state.selectedFaces = [...state.selectedFaces, faceKey]
  state.status = 'Face added.'
  updateSelectionUi()
  renderCube()
}

function submitSelection() {
  if (!state.dictionary || state.gameOverReason) {
    return
  }

  const faceMap = buildFaceMap(getExposedFaces(state.cube))
  const word = selectionToWord(state.selectedFaces, faceMap)
  const hintedSelection = state.hintedWords.has(word)

  if (word.length < 4) {
    state.selectedFaces = []
    state.status = 'Words must be at least 4 letters.'
    renderShell()
    renderCube()
    return
  }

  if (!state.dictionary.has(word)) {
    state.selectedFaces = []
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

  state.foundWords = [{ word, points }, ...state.foundWords]
  state.cube = removeSelectedBlocks(state.cube, state.selectedFaces, faceMap)
  state.selectedFaces = []
  state.status =
    points === null
      ? `${word} accepted as a hint. No score awarded. Selected blocks removed.`
      : `${word} accepted for ${points} point${points === 1 ? '' : 's'}. Selected blocks removed.`
  updateGameOverState()
  renderShell()
  renderCube()
}

function currentWord(): string {
  const faceMap = buildFaceMap(getExposedFaces(state.cube))
  return selectionToWord(state.selectedFaces, faceMap)
}

function handleYawChange(yawRadians: number, pitchRadians = state.pitchRadians) {
  state.yawRadians = yawRadians
  state.pitchRadians = pitchRadians
  if (!state.gameOverReason) {
    state.status = 'Selection preserved.'
  }
  renderCube()
}

function submitDisabled(): boolean {
  return state.loading || state.selectedFaces.length === 0 || state.gameOverReason !== null
}

function scoreWord(word: string): number {
  return Math.max(1, word.length - 3)
}

function renderFoundWords(): string {
  if (state.foundWords.length === 0) {
    return '<p class="history-empty">No words found yet.</p>'
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
    ${state.foundWords.length === 0 ? '<div class="desktop-history-empty">No words found yet.</div>' : ''}
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

function renderActionIcon(kind: 'hint' | 'rapid'): string {
  if (kind === 'hint') {
    return `
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 2.5a5.1 5.1 0 0 0-3.72 8.6c.62.66 1 1.42 1.13 2.27h5.18c.12-.85.5-1.61 1.12-2.27A5.1 5.1 0 0 0 10 2.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        <path d="M7.9 15.15h4.2M8.4 17.2h3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
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

function updateGameOverState() {
  const remainingBlocks = countRemainingBlocks(state.cube)

  if (remainingBlocks === 0) {
    awardCubeClearBonus()
    state.gameOverReason = 'cleared'
    state.status = 'GAME OVER. Cube cleared.'
    return
  }

  if (state.dictionary && !findAnyLegalWord(state.cube, state.dictionary, state.dictionaryPrefixes)) {
    state.gameOverReason = 'no_more_words'
    state.status = 'GAME OVER. No more words.'
    return
  }

  state.gameOverReason = null
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

  return `
    <div class="game-over-overlay">
      <div class="game-over-card">
        <p class="game-over-title">GAME OVER</p>
        <p class="game-over-reason">${state.gameOverReason === 'cleared' ? 'CUBE CLEARED' : 'NO MORE WORDS'}</p>
        <p class="game-over-stat"><span>Score</span><strong>${state.score}</strong></p>
        <p class="game-over-stat"><span>Longest word</span><strong>${longestWord ?? 'None'}</strong></p>
        <button class="action game-over-action" data-action="replay">Replay</button>
      </div>
    </div>
  `
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

  if (state.scoreEvents.some(({ label }) => label === 'Cube cleared')) {
    return
  }

  state.score += CUBE_CLEAR_BONUS
  state.scoreEvents = [{ label: 'Cube cleared', points: CUBE_CLEAR_BONUS }, ...state.scoreEvents]
}

function rapidSolve() {
  if (!state.dictionary || state.gameOverReason) {
    return
  }

  state.selectedFaces = []

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

function replayGame() {
  state.cube = createCubeState()
  state.selectedFaces = []
  state.score = 0
  state.foundWords = []
  state.scoreEvents = []
  state.gameOverReason = null
  state.hintedWords = new Set()
  state.hintUsedThisRun = false
  state.historySheetOpen = false
  state.status = 'Select adjacent visible faces that share an edge.'
  renderShell()
  renderCube()
}

function applyHint() {
  if (!state.dictionary || !state.popularDictionary || state.gameOverReason) {
    return
  }

  const hint =
    findShortestLegalWord(state.cube, state.popularDictionary, state.popularPrefixes) ??
    findShortestLegalWord(state.cube, state.dictionary, state.dictionaryPrefixes)

  if (!hint) {
    updateGameOverState()
    state.status = 'No hint available.'
    renderShell()
    renderCube()
    return
  }

  state.selectedFaces = hint.faceKeys
  state.hintedWords.add(hint.word)
  state.hintUsedThisRun = true
  state.status = `Hint: ${hint.word}`
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
