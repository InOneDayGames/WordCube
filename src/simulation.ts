import {
  buildFaceMap,
  canAppendFace,
  countLetters,
  countRemainingBlocks,
  countVowels,
  createCubeState,
  createSeededRandom,
  getExposedFaces,
  removeSelectedBlocks,
  type CubeState,
  type LetterWeights,
} from './cube.js'

export type SimulationOptions = {
  runs: number
  minWordLength: number
  maxWordLength: number
  letterWeights?: LetterWeights
  seed?: number
}

export type SimulationSummary = {
  runs: number
  seed: number
  minWordLength: number
  maxWordLength: number
  averageInitialPopularWordsExposed: number
  averageWordsPlayedPerRun: number
  averageBlocksRemovedPerRun: number
  averageBlocksLeftWhenStuck: number
  averageExposedFacesPerTurn: number
  averageVowelsPerCube: number
  averageUniqueLettersPerCube: number
  averageStartingSurfaceRareLetters: number
  cubesWithStartingSurfaceRareLetterShare: number
  startingSurfaceRareLetterBreakdown: Array<{ letter: string; averagePerCube: number; cubeShare: number }>
  deadBoardShare: number
  topPlayedWords: Array<{ word: string; count: number }>
  letterHistogram: Array<{ letter: string; count: number }>
}

const RARE_LETTERS = ['J', 'Q', 'X', 'Z'] as const

type DictionaryData = {
  words: Set<string>
  prefixes: Set<string>
  preferredWords: Set<string>
}

type CandidatePlay = {
  word: string
  faceKeys: string[]
  uniqueBlockCount: number
  preferred: boolean
}

export function createDictionaryData(words: Iterable<string>, minWordLength: number): DictionaryData {
  return createDictionaryDataWithPreferences(words, [], minWordLength)
}

export function createDictionaryDataWithPreferences(
  words: Iterable<string>,
  preferredWords: Iterable<string>,
  minWordLength: number,
): DictionaryData {
  const filteredWords = new Set<string>()
  const prefixes = new Set<string>()
  const filteredPreferredWords = new Set<string>()

  for (const word of words) {
    const upper = word.trim().toUpperCase()

    if (!/^[A-Z]+$/.test(upper) || upper.length < minWordLength) {
      continue
    }

    filteredWords.add(upper)

    for (let index = 1; index < upper.length; index += 1) {
      prefixes.add(upper.slice(0, index))
    }
  }

  for (const word of preferredWords) {
    const upper = word.trim().toUpperCase()

    if (!/^[A-Z]+$/.test(upper) || upper.length < minWordLength || !filteredWords.has(upper)) {
      continue
    }

    filteredPreferredWords.add(upper)
  }

  return {
    words: filteredWords,
    prefixes,
    preferredWords: filteredPreferredWords,
  }
}

export function runSimulation(
  dictionary: DictionaryData,
  options: SimulationOptions,
): SimulationSummary {
  const seed = options.seed ?? Date.now()
  const random = createSeededRandom(seed)
  const playedWordCounts = new Map<string, number>()
  const letterHistogram = new Map<string, number>()
  let totalWordsPlayed = 0
  let totalBlocksRemoved = 0
  let totalBlocksLeftWhenStuck = 0
  let totalInitialPopularWordsExposed = 0
  let deadBoards = 0
  let totalExposedFaces = 0
  let totalTurns = 0
  let totalVowels = 0
  let totalUniqueLetters = 0
  let totalStartingSurfaceRareLetters = 0
  let cubesWithStartingSurfaceRareLetter = 0
  const startingRareCounts = new Map<string, number>(RARE_LETTERS.map((letter) => [letter, 0]))
  const startingRareCubeHits = new Map<string, number>(RARE_LETTERS.map((letter) => [letter, 0]))

  for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
    let cube = createCubeState({
      letterWeights: options.letterWeights,
      random,
    })
    let wordsPlayedThisRun = 0
    let blocksRemovedThisRun = 0
    const startingExposedFaces = getExposedFaces(cube)
    const startingPlays = enumeratePlays(cube, dictionary, options.minWordLength, options.maxWordLength)
    const initialPopularWords = new Set(
      startingPlays.filter((play) => play.preferred).map((play) => play.word),
    )
    const startingRareFaces = startingExposedFaces.filter((face) =>
      RARE_LETTERS.includes(face.letter as (typeof RARE_LETTERS)[number]),
    )

    totalInitialPopularWordsExposed += initialPopularWords.size
    totalStartingSurfaceRareLetters += startingRareFaces.length

    if (startingRareFaces.length > 0) {
      cubesWithStartingSurfaceRareLetter += 1
    }

    for (const rareLetter of RARE_LETTERS) {
      const matches = startingRareFaces.filter((face) => face.letter === rareLetter)
      startingRareCounts.set(rareLetter, (startingRareCounts.get(rareLetter) ?? 0) + matches.length)
      if (matches.length > 0) {
        startingRareCubeHits.set(rareLetter, (startingRareCubeHits.get(rareLetter) ?? 0) + 1)
      }
    }

    totalVowels += countVowels(cube)
    totalUniqueLetters += new Set(
      cube.blocks.flatMap((block) => Object.values(block.letters)),
    ).size

    for (const [letter, count] of countLetters(cube)) {
      letterHistogram.set(letter, (letterHistogram.get(letter) ?? 0) + count)
    }

    while (true) {
      const exposedFaces = getExposedFaces(cube)
      totalExposedFaces += exposedFaces.length
      totalTurns += 1

      const plays = enumeratePlays(cube, dictionary, options.minWordLength, options.maxWordLength)
      const chosenPlay = choosePlay(plays)

      if (!chosenPlay) {
        const blocksLeft = countRemainingBlocks(cube)
        totalBlocksLeftWhenStuck += blocksLeft

        if (blocksLeft > 0) {
          deadBoards += 1
        }

        break
      }

      const faceMap = buildFaceMap(exposedFaces)
      cube = removeSelectedBlocks(cube, chosenPlay.faceKeys, faceMap)
      wordsPlayedThisRun += 1
      blocksRemovedThisRun += chosenPlay.uniqueBlockCount
      playedWordCounts.set(chosenPlay.word, (playedWordCounts.get(chosenPlay.word) ?? 0) + 1)
    }

    totalWordsPlayed += wordsPlayedThisRun
    totalBlocksRemoved += blocksRemovedThisRun
  }

  return {
    runs: options.runs,
    seed,
    minWordLength: options.minWordLength,
    maxWordLength: options.maxWordLength,
    averageInitialPopularWordsExposed: totalInitialPopularWordsExposed / options.runs,
    averageWordsPlayedPerRun: totalWordsPlayed / options.runs,
    averageBlocksRemovedPerRun: totalBlocksRemoved / options.runs,
    averageBlocksLeftWhenStuck: totalBlocksLeftWhenStuck / options.runs,
    averageExposedFacesPerTurn: totalTurns === 0 ? 0 : totalExposedFaces / totalTurns,
    averageVowelsPerCube: totalVowels / options.runs,
    averageUniqueLettersPerCube: totalUniqueLetters / options.runs,
    averageStartingSurfaceRareLetters: totalStartingSurfaceRareLetters / options.runs,
    cubesWithStartingSurfaceRareLetterShare: cubesWithStartingSurfaceRareLetter / options.runs,
    startingSurfaceRareLetterBreakdown: RARE_LETTERS.map((letter) => ({
      letter,
      averagePerCube: (startingRareCounts.get(letter) ?? 0) / options.runs,
      cubeShare: (startingRareCubeHits.get(letter) ?? 0) / options.runs,
    })),
    deadBoardShare: deadBoards / options.runs,
    topPlayedWords: [...playedWordCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 15)
      .map(([word, count]) => ({ word, count })),
    letterHistogram: [...letterHistogram.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([letter, count]) => ({ letter, count })),
  }
}

function enumeratePlays(
  cube: CubeState,
  dictionary: DictionaryData,
  minWordLength: number,
  maxWordLength: number,
): CandidatePlay[] {
  const faces = getExposedFaces(cube)
  const faceMap = buildFaceMap(faces)
  const plays = new Map<string, CandidatePlay>()

  for (const startFace of faces) {
    searchFromPath([startFace.key], startFace.letter)
  }

  return [...plays.values()]

  function searchFromPath(path: string[], currentWord: string) {
    if (currentWord.length >= minWordLength && dictionary.words.has(currentWord)) {
      const uniqueBlockCount = new Set(
        path
          .map((faceKey) => faceMap.get(faceKey)?.blockId)
          .filter((blockId): blockId is string => Boolean(blockId)),
      ).size
      const key = `${currentWord}|${path.join('>')}`
      plays.set(key, {
        word: currentWord,
        faceKeys: [...path],
        uniqueBlockCount,
        preferred: dictionary.preferredWords.has(currentWord),
      })
    }

    if (currentWord.length >= maxWordLength || !dictionary.prefixes.has(currentWord)) {
      return
    }

    for (const candidate of faces) {
      if (!canAppendFace(path, candidate.key, faceMap, cube)) {
        continue
      }

      searchFromPath([...path, candidate.key], currentWord + candidate.letter)
    }
  }
}

function choosePlay(plays: CandidatePlay[]): CandidatePlay | null {
  if (plays.length === 0) {
    return null
  }

  return [...plays].sort((a, b) => {
    return (
      Number(b.preferred) - Number(a.preferred) ||
      a.word.length - b.word.length ||
      a.uniqueBlockCount - b.uniqueBlockCount ||
      a.word.localeCompare(b.word) ||
      a.faceKeys.join('>').localeCompare(b.faceKeys.join('>'))
    )
  })[0]
}
