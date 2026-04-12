import {
  buildFaceMap,
  canAppendFace,
  countLetters,
  countVowels,
  createCubeState,
  createSeededRandom,
  getExposedFaces,
  type CubeState,
  type FaceRef,
  type LetterWeights,
} from './cube.js'

export type WordData = {
  words: Set<string>
  prefixes: Set<string>
}

export type CubeOpportunityOptions = {
  minWordLength: number
  starterMaxWordLength: number
  longMaxWordLength: number
  perfectMaxStates: number
}

export type WordOpportunity = {
  word: string
  faceKeys: string[]
  blockIds: string[]
  removalKey: string
}

export type LongestReachableWordResult = {
  word: string | null
  length: number
  statesExplored: number
  capped: boolean
}

export type CubeOpportunityAnalysis = {
  seed: number
  starterPopularTotal: number
  starterPopularByLength: Array<{ length: number; count: number }>
  starterPopularExamples: string[]
  starterPopularWords: string[]
  startingLongestWord: string | null
  startingLongestWordLength: number
  longestReachableWord: LongestReachableWordResult | null
  vowelCount: number
  uniqueLetterCount: number
  letterHistogram: Array<{ letter: string; count: number }>
}

type OpportunityFace = {
  key: string
  blockId: string
  letter: string
}

type WordCandidate = {
  word: string
  length: number
}

export function createWordData(words: Iterable<string>, minWordLength: number): WordData {
  const filteredWords = new Set<string>()
  const prefixes = new Set<string>()

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

  return {
    words: filteredWords,
    prefixes,
  }
}

export function createCubeForSeed(seed: number, letterWeights?: LetterWeights): CubeState {
  return createCubeState({
    letterWeights,
    random: createSeededRandom(seed),
  })
}

export function analyzeCubeOpportunities(
  seed: number,
  cube: CubeState,
  legalWords: WordData,
  popularWords: WordData,
  options: CubeOpportunityOptions,
  includePerfectSearch: boolean,
): CubeOpportunityAnalysis {
  const starterPopularOpportunities = enumerateWordOpportunities(
    cube,
    popularWords,
    options.minWordLength,
    options.starterMaxWordLength,
  )
  const starterPopularWords = uniqueWords(starterPopularOpportunities).sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  )
  const startingLegalOpportunities = enumerateWordOpportunities(
    cube,
    legalWords,
    options.minWordLength,
    options.longMaxWordLength,
  )
  const startingLongestWord = chooseLongestWord(uniqueWords(startingLegalOpportunities))
  const letterHistogram = [...countLetters(cube).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([letter, count]) => ({ letter, count }))

  return {
    seed,
    starterPopularTotal: starterPopularWords.length,
    starterPopularByLength: countWordsByLength(starterPopularWords, options.minWordLength, options.starterMaxWordLength),
    starterPopularExamples: starterPopularWords.slice(0, 10),
    starterPopularWords,
    startingLongestWord: startingLongestWord.word || null,
    startingLongestWordLength: startingLongestWord.length,
    longestReachableWord: includePerfectSearch
      ? findLongestReachableWord(cube, legalWords, options.minWordLength, options.longMaxWordLength, options.perfectMaxStates)
      : null,
    vowelCount: countVowels(cube),
    uniqueLetterCount: letterHistogram.filter(({ count }) => count > 0).length,
    letterHistogram,
  }
}

export function enumerateWordOpportunities(
  cube: CubeState,
  dictionary: WordData,
  minWordLength: number,
  maxWordLength: number,
): WordOpportunity[] {
  const faces = getExposedFaces(cube)
  const faceMap = buildFaceMap(faces)
  const adjacency = buildAdjacencyMap(cube, faces, faceMap)

  return enumerateWordOpportunitiesForFaces(faces, adjacency, dictionary, minWordLength, maxWordLength)
}

function enumerateWordOpportunitiesForFaces(
  faces: OpportunityFace[],
  adjacency: Map<string, string[]>,
  dictionary: WordData,
  minWordLength: number,
  maxWordLength: number,
): WordOpportunity[] {
  const faceMap = new Map(faces.map((face) => [face.key, face]))
  const opportunities = new Map<string, WordOpportunity>()

  for (const startFace of faces) {
    searchFromPath([startFace.key], startFace.letter)
  }

  return [...opportunities.values()]

  function searchFromPath(path: string[], currentWord: string) {
    if (currentWord.length >= minWordLength && dictionary.words.has(currentWord)) {
      const opportunity = createWordOpportunity(currentWord, path, faceMap)
      opportunities.set(`${currentWord}|${path.join('>')}`, opportunity)
    }

    if (currentWord.length >= maxWordLength || !dictionary.prefixes.has(currentWord)) {
      return
    }

    const previousFaceKey = path[path.length - 1]
    const neighbors = adjacency.get(previousFaceKey) ?? []

    for (const candidateKey of neighbors) {
      if (path.includes(candidateKey)) {
        continue
      }

      const candidate = faceMap.get(candidateKey)

      if (!candidate) {
        continue
      }

      searchFromPath([...path, candidateKey], currentWord + candidate.letter)
    }
  }
}

export function findLongestReachableWord(
  cube: CubeState,
  dictionary: WordData,
  minWordLength: number,
  maxWordLength: number,
  maxStates: number,
): LongestReachableWordResult {
  const memo = new Map<string, WordCandidate>()
  let statesExplored = 0
  let capped = false

  const best = searchState(cube)

  return {
    word: best.word || null,
    length: best.length,
    statesExplored,
    capped,
  }

  function searchState(currentCube: CubeState): WordCandidate {
    const key = createCubeStateKey(currentCube)
    const cached = memo.get(key)

    if (cached) {
      return cached
    }

    statesExplored += 1

    const opportunities = enumerateWordOpportunities(currentCube, dictionary, minWordLength, maxWordLength)
    const uniqueCandidates = uniqueWords(opportunities)
    let bestForState = chooseLongestWord(uniqueCandidates)

    if (statesExplored >= maxStates) {
      capped = true
      memo.set(key, bestForState)
      return bestForState
    }

    const removalCandidates = uniqueRemovalCandidates(opportunities)

    for (const candidate of removalCandidates) {
      if (statesExplored >= maxStates) {
        capped = true
        break
      }

      const childBest = searchState(removeBlocks(currentCube, candidate.blockIds))
      bestForState = chooseBetterWord(bestForState, childBest)
    }

    memo.set(key, bestForState)
    return bestForState
  }
}

function buildAdjacencyMap(cube: CubeState, faces: FaceRef[], faceMap: Map<string, FaceRef>): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()

  for (const face of faces) {
    const neighbors = faces
      .filter((candidate) => candidate.key !== face.key && canAppendFace([face.key], candidate.key, faceMap, cube))
      .map((candidate) => candidate.key)

    adjacency.set(face.key, neighbors)
  }

  return adjacency
}

function createWordOpportunity(
  word: string,
  faceKeys: string[],
  faceMap: ReadonlyMap<string, OpportunityFace>,
): WordOpportunity {
  const blockIds = [
    ...new Set(
      faceKeys
        .map((faceKey) => faceMap.get(faceKey)?.blockId)
        .filter((blockId): blockId is string => Boolean(blockId)),
    ),
  ].sort()

  return {
    word,
    faceKeys: [...faceKeys],
    blockIds,
    removalKey: blockIds.join('|'),
  }
}

function uniqueWords(opportunities: WordOpportunity[]): string[] {
  return [...new Set(opportunities.map((opportunity) => opportunity.word))]
}

function countWordsByLength(words: string[], minLength: number, maxLength: number): Array<{ length: number; count: number }> {
  const counts = new Map<number, number>()

  for (let length = minLength; length <= maxLength; length += 1) {
    counts.set(length, 0)
  }

  for (const word of words) {
    counts.set(word.length, (counts.get(word.length) ?? 0) + 1)
  }

  return [...counts.entries()].map(([length, count]) => ({ length, count }))
}

function chooseLongestWord(words: string[]): WordCandidate {
  return words.reduce<WordCandidate>(
    (best, word) => chooseBetterWord(best, { word, length: word.length }),
    { word: '', length: 0 },
  )
}

function chooseBetterWord(current: WordCandidate, candidate: WordCandidate): WordCandidate {
  if (candidate.length > current.length) {
    return candidate
  }

  if (candidate.length === current.length && candidate.word && (!current.word || candidate.word.localeCompare(current.word) < 0)) {
    return candidate
  }

  return current
}

function uniqueRemovalCandidates(opportunities: WordOpportunity[]): WordOpportunity[] {
  const byRemoval = new Map<string, WordOpportunity>()

  for (const opportunity of opportunities) {
    const existing = byRemoval.get(opportunity.removalKey)

    if (
      !existing ||
      opportunity.word.length > existing.word.length ||
      (opportunity.word.length === existing.word.length && opportunity.word.localeCompare(existing.word) < 0)
    ) {
      byRemoval.set(opportunity.removalKey, opportunity)
    }
  }

  return [...byRemoval.values()].sort((a, b) => {
    return b.word.length - a.word.length || b.blockIds.length - a.blockIds.length || a.word.localeCompare(b.word)
  })
}

function removeBlocks(cube: CubeState, blockIds: string[]): CubeState {
  const removedBlockIds = new Set(blockIds)

  return {
    blocks: cube.blocks.map((block) =>
      removedBlockIds.has(block.id)
        ? {
            ...block,
            removed: true,
          }
        : block,
    ),
  }
}

function createCubeStateKey(cube: CubeState): string {
  return cube.blocks.map((block) => (block.removed ? '1' : '0')).join('')
}
