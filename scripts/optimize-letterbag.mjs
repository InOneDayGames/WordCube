import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_LETTER_WEIGHTS, MINIMUM_LETTER_WEIGHTS } from '../.tmp_sim/src/cube.js'
import { createDictionaryDataWithPreferences, runSimulation } from '../.tmp_sim/src/simulation.js'

const dictionaryPath = resolve(process.cwd(), 'public', 'dictionary.txt')
const popularPath = resolve(process.cwd(), 'public', 'popular.txt')
const dictionaryText = readFileSync(dictionaryPath, 'utf8')
const popularText = readFileSync(popularPath, 'utf8')
const options = parseArgs(process.argv.slice(2))
const dictionary = createDictionaryDataWithPreferences(
  dictionaryText.split(/\r?\n/),
  popularText.split(/\r?\n/),
  options.minWordLength,
)
const batchStartedAt = new Date().toISOString()
const resultsDir = resolve(process.cwd(), 'reports', 'letterbag-tuning')

mkdirSync(resultsDir, { recursive: true })

const batch = runBatch(dictionary, options)
const batchId = createBatchId()
const outputPath = resolve(resultsDir, `${batchId}.json`)

writeFileSync(outputPath, JSON.stringify({ batchStartedAt, ...batch }, null, 2))

console.log(JSON.stringify({ outputPath, ...batch }, null, 2))

function runBatch(dictionaryData, cliOptions) {
  let currentWeights = cliOptions.baseWeights
  let currentSummary = evaluateBag(dictionaryData, currentWeights, cliOptions, cliOptions.seed)
  const iterations = []

  for (let iteration = 1; iteration <= cliOptions.iterations; iteration += 1) {
    const mutationSeed = cliOptions.seed + iteration * 9973
    const candidateWeights = mutateWeights(currentWeights, mutationSeed)
    const candidateSummary = evaluateBag(
      dictionaryData,
      candidateWeights,
      cliOptions,
      cliOptions.seed + iteration,
    )
    const accepted = compareSummaries(candidateSummary, currentSummary) > 0

    iterations.push({
      iteration,
      accepted,
      mutationSeed,
      baseline: summarizeForLog(currentSummary),
      candidate: summarizeForLog(candidateSummary),
      candidateWeights,
    })

    if (accepted) {
      currentWeights = candidateWeights
      currentSummary = candidateSummary
    }
  }

  return {
    iterationsRequested: cliOptions.iterations,
    evaluationRunsPerIteration: cliOptions.runs,
    minWordLength: cliOptions.minWordLength,
    maxWordLength: cliOptions.maxWordLength,
    seed: cliOptions.seed,
    startingWeights: cliOptions.baseWeights,
    finalWeights: currentWeights,
    finalSummary: summarizeForLog(currentSummary),
    acceptedIterations: iterations.filter((iteration) => iteration.accepted).length,
    iterations,
  }
}

function evaluateBag(dictionaryData, letterWeights, cliOptions, seed) {
  return runSimulation(dictionaryData, {
    runs: cliOptions.runs,
    minWordLength: cliOptions.minWordLength,
    maxWordLength: cliOptions.maxWordLength,
    seed,
    letterWeights,
  })
}

function compareSummaries(candidate, incumbent) {
  const candidateRarePenalty = rareLetterPenalty(candidate)
  const incumbentRarePenalty = rareLetterPenalty(incumbent)

  if (candidate.averageInitialPopularWordsExposed !== incumbent.averageInitialPopularWordsExposed) {
    return candidate.averageInitialPopularWordsExposed - incumbent.averageInitialPopularWordsExposed
  }

  if (candidateRarePenalty !== incumbentRarePenalty) {
    return incumbentRarePenalty - candidateRarePenalty
  }

  if (candidate.averageWordsPlayedPerRun !== incumbent.averageWordsPlayedPerRun) {
    return candidate.averageWordsPlayedPerRun - incumbent.averageWordsPlayedPerRun
  }

  if (candidate.averageBlocksLeftWhenStuck !== incumbent.averageBlocksLeftWhenStuck) {
    return incumbent.averageBlocksLeftWhenStuck - candidate.averageBlocksLeftWhenStuck
  }

  return candidate.averageBlocksRemovedPerRun - incumbent.averageBlocksRemovedPerRun
}

function rareLetterPenalty(summary) {
  return Math.abs(summary.averageStartingSurfaceRareLetters - 1)
}

function mutateWeights(weights, seed) {
  const random = createSeededRandom(seed)
  const next = new Map(weights.map(([letter, weight]) => [letter, weight]))
  const floors = new Map(MINIMUM_LETTER_WEIGHTS)
  const letters = [...next.keys()]
  const donor = letters[Math.floor(random() * letters.length)]
  const receiver = letters[Math.floor(random() * letters.length)]
  const donorWeight = next.get(donor) ?? 0
  const donorFloor = floors.get(donor) ?? 0

  if (donor !== receiver && donorWeight > donorFloor) {
    next.set(donor, donorWeight - 1)
    next.set(receiver, (next.get(receiver) ?? 0) + 1)
  } else {
    const target = letters[Math.floor(random() * letters.length)]
    const targetFloor = floors.get(target) ?? 0
    const delta = random() < 0.5 ? -1 : 1
    next.set(target, Math.max(targetFloor, (next.get(target) ?? 0) + delta))
  }

  for (const [letter, floor] of floors) {
    next.set(letter, Math.max(floor, next.get(letter) ?? 0))
  }

  return [...next.entries()].filter(([, weight]) => weight > 0)
}

function summarizeForLog(summary) {
  return {
    averageInitialPopularWordsExposed: summary.averageInitialPopularWordsExposed,
    averageWordsPlayedPerRun: summary.averageWordsPlayedPerRun,
    averageBlocksRemovedPerRun: summary.averageBlocksRemovedPerRun,
    averageBlocksLeftWhenStuck: summary.averageBlocksLeftWhenStuck,
    averageStartingSurfaceRareLetters: summary.averageStartingSurfaceRareLetters,
    cubesWithStartingSurfaceRareLetterShare: summary.cubesWithStartingSurfaceRareLetterShare,
    startingSurfaceRareLetterBreakdown: summary.startingSurfaceRareLetterBreakdown,
    deadBoardShare: summary.deadBoardShare,
    topPlayedWords: summary.topPlayedWords.slice(0, 8),
  }
}

function parseArgs(args) {
  const options = {
    iterations: 10,
    runs: 100,
    minWordLength: 4,
    maxWordLength: 8,
    seed: 12345,
    baseWeights: DEFAULT_LETTER_WEIGHTS,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]

    switch (arg) {
      case '--iterations':
        options.iterations = Number(next)
        index += 1
        break
      case '--runs':
        options.runs = Number(next)
        index += 1
        break
      case '--min':
        options.minWordLength = Number(next)
        index += 1
        break
      case '--max':
        options.maxWordLength = Number(next)
        index += 1
        break
      case '--seed':
        options.seed = Number(next)
        index += 1
        break
      case '--weights':
        options.baseWeights = parseWeights(next)
        index += 1
        break
      default:
        break
    }
  }

  return options
}

function parseWeights(input) {
  if (!input) {
    return DEFAULT_LETTER_WEIGHTS
  }

  return input.split(',').map((entry) => {
    const [letter, weight] = entry.split(':')
    const normalizedLetter = letter.trim().toUpperCase()
    const normalizedWeight = Number(weight)

    if (!/^[A-Z]$/.test(normalizedLetter) || !Number.isFinite(normalizedWeight) || normalizedWeight < 0) {
      throw new Error(`Invalid weight entry: ${entry}`)
    }

    return [normalizedLetter, normalizedWeight]
  })
}

function createSeededRandom(seed) {
  let state = seed >>> 0

  return () => {
    state += 0x6d2b79f5
    let next = state
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function createBatchId() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}
