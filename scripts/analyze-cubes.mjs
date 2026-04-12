import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_LETTER_WEIGHTS } from '../.tmp_sim/src/cube.js'
import { analyzeCubeOpportunities, createCubeForSeed, createWordData } from '../.tmp_sim/src/cubeOpportunities.js'

const options = normalizeOptions(parseArgs(process.argv.slice(2)))
const dictionaryWords = readWordList(resolve(process.cwd(), 'public', 'dictionary.txt'))
const legalWordSet = new Set(dictionaryWords)
const rawPopularWords = readWordList(resolve(process.cwd(), 'public', 'popular.txt'))
const legalPopularWords = rawPopularWords.filter((word) => legalWordSet.has(word))
const legalWords = createWordData(dictionaryWords, options.minWordLength)
const popularWords = createWordData(legalPopularWords, options.minWordLength)
const analyses = []
const startedAt = Date.now()

for (let index = 0; index < options.runs; index += 1) {
  const seed = options.seed + index
  const cube = createCubeForSeed(seed, options.letterWeights)

  analyses.push(
    analyzeCubeOpportunities(
      seed,
      cube,
      legalWords,
      popularWords,
      {
        minWordLength: options.minWordLength,
        starterMaxWordLength: options.starterMaxWordLength,
        longMaxWordLength: options.longMaxWordLength,
        perfectMaxStates: options.perfectMaxStates,
      },
      index < options.perfectRuns,
    ),
  )
}

const elapsedMs = Date.now() - startedAt
const summary = summarize(analyses, options, {
  dictionaryWords: dictionaryWords.length,
  maxLegalWordLength: longestWordLength(dictionaryWords),
  rawPopularWords: rawPopularWords.length,
  legalPopularWords: legalPopularWords.length,
  elapsedMs,
})

if (options.json) {
  console.log(JSON.stringify({ options: serializableOptions(options), summary, analyses }, null, 2))
} else {
  printHumanReport(summary)
  printDebugReports(analyses, options)
}

function readWordList(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((word) => word.trim().toUpperCase())
    .filter((word) => /^[A-Z]+$/.test(word))
}

function summarize(analyses, runOptions, dictionaryStats) {
  const starterTotals = analyses.map((analysis) => analysis.starterPopularTotal)
  const startingLongestLengths = analyses.map((analysis) => analysis.startingLongestWordLength)
  const perfectAnalyses = analyses.filter((analysis) => analysis.longestReachableWord)
  const perfectLengths = perfectAnalyses.map((analysis) => analysis.longestReachableWord.length)
  const letterHistogram = aggregateLetterHistogram(analyses)
  const totalLetters = analyses.length * 27 * 6

  return {
    runs: analyses.length,
    seedStart: runOptions.seed,
    seedEnd: runOptions.seed + analyses.length - 1,
    minWordLength: runOptions.minWordLength,
    starterMaxWordLength: runOptions.starterMaxWordLength,
    longMaxWordLength: runOptions.longMaxWordLength,
    perfectRuns: perfectAnalyses.length,
    perfectMaxStates: runOptions.perfectMaxStates,
    elapsedMs: dictionaryStats.elapsedMs,
    dictionaryStats,
    starter: {
      averageTotal: average(starterTotals),
      averageByLength: wordLengthRange(runOptions.minWordLength, runOptions.starterMaxWordLength).map((length) => ({
        length,
        average: average(analyses.map((analysis) => countByLength(analysis, length))),
      })),
      bands: [
        createBand('0', starterTotals, (count) => count === 0),
        createBand('1-5', starterTotals, (count) => count >= 1 && count <= 5),
        createBand('6-10', starterTotals, (count) => count >= 6 && count <= 10),
        createBand('11-20', starterTotals, (count) => count >= 11 && count <= 20),
        createBand('21+', starterTotals, (count) => count >= 21),
      ],
      hardest: [...analyses]
        .sort((a, b) => a.starterPopularTotal - b.starterPopularTotal || a.seed - b.seed)
        .slice(0, 5)
        .map((analysis) => ({
          seed: analysis.seed,
          starterPopularTotal: analysis.starterPopularTotal,
          byLength: analysis.starterPopularByLength,
          examples: analysis.starterPopularExamples,
        })),
    },
    longWords: {
      startingSurface: describeNumberSet(startingLongestLengths),
      startingBestExamples: [...analyses]
        .sort((a, b) => b.startingLongestWordLength - a.startingLongestWordLength || a.seed - b.seed)
        .slice(0, 5)
        .map((analysis) => ({
          seed: analysis.seed,
          word: analysis.startingLongestWord,
          length: analysis.startingLongestWordLength,
        })),
      perfectReachable:
        perfectAnalyses.length === 0
          ? null
          : {
              ...describeNumberSet(perfectLengths),
              cappedRuns: perfectAnalyses.filter((analysis) => analysis.longestReachableWord.capped).length,
              averageStatesExplored: average(
                perfectAnalyses.map((analysis) => analysis.longestReachableWord.statesExplored),
              ),
              bestExamples: [...perfectAnalyses]
                .sort(
                  (a, b) =>
                    b.longestReachableWord.length - a.longestReachableWord.length ||
                    (a.longestReachableWord.word ?? '').localeCompare(b.longestReachableWord.word ?? '') ||
                    a.seed - b.seed,
                )
                .slice(0, 5)
                .map((analysis) => ({
                  seed: analysis.seed,
                  word: analysis.longestReachableWord.word,
                  length: analysis.longestReachableWord.length,
                  capped: analysis.longestReachableWord.capped,
                  statesExplored: analysis.longestReachableWord.statesExplored,
                })),
              weakestExamples: [...perfectAnalyses]
                .sort(
                  (a, b) =>
                    a.longestReachableWord.length - b.longestReachableWord.length ||
                    a.seed - b.seed,
                )
                .slice(0, 5)
                .map((analysis) => ({
                  seed: analysis.seed,
                  word: analysis.longestReachableWord.word,
                  length: analysis.longestReachableWord.length,
                  capped: analysis.longestReachableWord.capped,
                  statesExplored: analysis.longestReachableWord.statesExplored,
                })),
            },
    },
    letters: {
      averageVowelsPerCube: average(analyses.map((analysis) => analysis.vowelCount)),
      averageUniqueLettersPerCube: average(analyses.map((analysis) => analysis.uniqueLetterCount)),
      histogram: letterHistogram.map(({ letter, count }) => ({
        letter,
        count,
        share: totalLetters === 0 ? 0 : count / totalLetters,
      })),
    },
  }
}

function printHumanReport(summary) {
  console.log('Word Cube opportunity analysis')
  console.log('==============================')
  console.log(`Cubes: ${summary.runs} seeds (${summary.seedStart} to ${summary.seedEnd})`)
  console.log(
    `Dictionaries: ${summary.dictionaryStats.dictionaryWords.toLocaleString()} legal words ` +
      `(max ${summary.dictionaryStats.maxLegalWordLength} letters), ` +
      `${summary.dictionaryStats.legalPopularWords.toLocaleString()} popular words usable as hints ` +
      `(${summary.dictionaryStats.rawPopularWords.toLocaleString()} raw popular entries)`,
  )
  console.log(
    `Search: starter words ${summary.minWordLength}-${summary.starterMaxWordLength} letters; ` +
      `long words up to ${summary.longMaxWordLength} letters on the starting surface`,
  )
  console.log(`Elapsed: ${formatSeconds(summary.elapsedMs)}`)
  console.log('')

  console.log('Starter accessibility')
  console.log('---------------------')
  console.log(
    `Average obvious starter words: ${formatNumber(summary.starter.averageTotal)} ` +
      `(popular ${summary.minWordLength}-${summary.starterMaxWordLength} letter words on the starting surface)`,
  )
  console.log(
    `By length: ${summary.starter.averageByLength
      .map(({ length, average: value }) => `${length} letters ${formatNumber(value)}`)
      .join(', ')}`,
  )
  console.log(`Banding: ${summary.starter.bands.map(formatBand).join(', ')}`)
  console.log('Hardest starts:')
  for (const item of summary.starter.hardest) {
    console.log(
      `  Seed ${item.seed}: ${item.starterPopularTotal} starter words ` +
        `(${item.byLength.map(({ length, count }) => `${length}L ${count}`).join(', ')})` +
        `${item.examples.length > 0 ? `; examples ${item.examples.join(', ')}` : '; no examples'}`,
    )
  }
  console.log('')

  console.log('Long-word opportunity')
  console.log('---------------------')
  console.log(`Starting surface longest word: ${formatNumberSet(summary.longWords.startingSurface)}`)
  console.log('Best starting-surface examples:')
  for (const item of summary.longWords.startingBestExamples) {
    console.log(`  Seed ${item.seed}: ${formatWordExample(item.word, item.length)}`)
  }

  if (summary.longWords.perfectReachable) {
    const perfect = summary.longWords.perfectReachable
    const capLabel =
      perfect.cappedRuns === 0
        ? 'exact within this search limit'
        : `${perfect.cappedRuns}/${summary.perfectRuns} runs hit the state cap, so treat as a lower bound`

    console.log(
      `Perfect-play reachable longest word: ${formatNumberSet(perfect)} across ${summary.perfectRuns} cubes; ${capLabel}`,
    )
    console.log(`Average search states explored: ${formatNumber(perfect.averageStatesExplored, 0)}`)
    console.log('Best perfect-play examples:')
    for (const item of perfect.bestExamples) {
      console.log(
        `  Seed ${item.seed}: ${formatWordExample(item.word, item.length)} ` +
          `(${item.statesExplored} states${item.capped ? ', capped' : ''})`,
      )
    }
    console.log('Weakest perfect-play examples:')
    for (const item of perfect.weakestExamples) {
      console.log(
        `  Seed ${item.seed}: ${formatWordExample(item.word, item.length)} ` +
          `(${item.statesExplored} states${item.capped ? ', capped' : ''})`,
      )
    }
  } else {
    console.log('Perfect-play reachable longest word: not run. Use --perfect-runs to enable it.')
  }
  console.log('')

  console.log('Letter mix')
  console.log('----------')
  console.log(
    `Average vowels per cube: ${formatNumber(summary.letters.averageVowelsPerCube)} / 162; ` +
      `average unique letters: ${formatNumber(summary.letters.averageUniqueLettersPerCube)}`,
  )
  console.log(`Most common letters: ${summary.letters.histogram.slice(0, 10).map(formatLetterShare).join(', ')}`)
  console.log(
    `Rare letters: ${summary.letters.histogram
      .filter(({ letter }) => ['J', 'Q', 'X', 'Z'].includes(letter))
      .map(formatLetterShare)
      .join(', ')}`,
  )
}

function parseArgs(args) {
  const options = {
    runs: 100,
    seed: 12345,
    minWordLength: 4,
    starterMaxWordLength: 5,
    longMaxWordLength: 12,
    perfectRuns: 0,
    perfectMaxStates: 5000,
    letterWeights: DEFAULT_LETTER_WEIGHTS,
    showStarterLength: null,
    showStarterLimit: 10,
    json: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]

    switch (arg) {
      case '--runs':
        options.runs = Number(next)
        index += 1
        break
      case '--seed':
        options.seed = Number(next)
        index += 1
        break
      case '--min':
        options.minWordLength = Number(next)
        index += 1
        break
      case '--starter-max':
        options.starterMaxWordLength = Number(next)
        index += 1
        break
      case '--long-max':
        options.longMaxWordLength = Number(next)
        index += 1
        break
      case '--perfect-runs':
        options.perfectRuns = Number(next)
        index += 1
        break
      case '--perfect-states':
        options.perfectMaxStates = Number(next)
        index += 1
        break
      case '--weights':
        options.letterWeights = parseWeights(next)
        index += 1
        break
      case '--show-starters':
        options.showStarterLength = Number(next)
        index += 1
        break
      case '--show-starters-limit':
        options.showStarterLimit = Number(next)
        index += 1
        break
      case '--json':
        options.json = true
        break
      case '--help':
        printHelp()
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function normalizeOptions(options) {
  assertPositiveInteger(options.runs, '--runs')
  assertPositiveInteger(options.seed, '--seed')
  assertPositiveInteger(options.minWordLength, '--min')
  assertPositiveInteger(options.starterMaxWordLength, '--starter-max')
  assertPositiveInteger(options.longMaxWordLength, '--long-max')
  assertPositiveInteger(options.perfectMaxStates, '--perfect-states')
  assertPositiveInteger(options.showStarterLimit, '--show-starters-limit')

  if (options.showStarterLength !== null) {
    assertPositiveInteger(options.showStarterLength, '--show-starters')
  }

  if (options.starterMaxWordLength < options.minWordLength) {
    throw new Error('--starter-max must be greater than or equal to --min')
  }

  if (options.longMaxWordLength < options.minWordLength) {
    throw new Error('--long-max must be greater than or equal to --min')
  }

  return {
    ...options,
    perfectRuns: Math.min(options.runs, options.perfectRuns),
  }
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

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
}

function serializableOptions(options) {
  return {
    ...options,
    letterWeights: options.letterWeights,
  }
}

function printDebugReports(analyses, options) {
  if (options.showStarterLength !== null) {
    printStarterWordDebug(analyses, options.showStarterLength, options.showStarterLimit)
  }
}

function printStarterWordDebug(analyses, length, limit) {
  const rows = analyses.map((analysis) => ({
    seed: analysis.seed,
    words: analysis.starterPopularWords.filter((word) => word.length === length),
  })).sort((a, b) => a.words.length - b.words.length || a.seed - b.seed)
  const counts = rows.map(({ words }) => words.length)
  const rowsToShow = rows.slice(0, limit)

  console.log('')
  console.log(`${length}-letter starter word debug`)
  console.log('---------------------------')
  console.log(
    `Average: ${formatNumber(average(counts))}; ` +
      `min ${counts.length === 0 ? 0 : Math.min(...counts)}; ` +
      `max ${counts.length === 0 ? 0 : Math.max(...counts)}`,
  )
  console.log(`Showing ${rowsToShow.length} of ${rows.length} cubes.`)

  for (const row of rowsToShow) {
    console.log(`  Seed ${row.seed}: ${row.words.length}${row.words.length > 0 ? ` - ${row.words.join(', ')}` : ' - none'}`)
  }
}

function wordLengthRange(minLength, maxLength) {
  const range = []

  for (let length = minLength; length <= maxLength; length += 1) {
    range.push(length)
  }

  return range
}

function countByLength(analysis, length) {
  return analysis.starterPopularByLength.find((entry) => entry.length === length)?.count ?? 0
}

function createBand(label, values, predicate) {
  const count = values.filter(predicate).length

  return {
    label,
    count,
    share: values.length === 0 ? 0 : count / values.length,
  }
}

function describeNumberSet(values) {
  return {
    average: average(values),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    max: values.length === 0 ? 0 : Math.max(...values),
  }
}

function average(values) {
  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function longestWordLength(words) {
  return words.reduce((max, word) => Math.max(max, word.length), 0)
}

function percentile(values, targetPercentile) {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.round((targetPercentile / 100) * (sorted.length - 1))

  return sorted[index]
}

function aggregateLetterHistogram(analyses) {
  const counts = new Map()

  for (const analysis of analyses) {
    for (const { letter, count } of analysis.letterHistogram) {
      counts.set(letter, (counts.get(letter) ?? 0) + count)
    }
  }

  return [...counts.entries()]
    .map(([letter, count]) => ({ letter, count }))
    .sort((a, b) => b.count - a.count || a.letter.localeCompare(b.letter))
}

function formatBand({ label, count, share }) {
  return `${label}: ${count} (${formatPercent(share)})`
}

function formatNumberSet(values) {
  return `avg ${formatNumber(values.average)}, p50 ${values.p50}, p90 ${values.p90}, max ${values.max}`
}

function formatLetterShare({ letter, share }) {
  return `${letter} ${formatPercent(share)}`
}

function formatWordExample(word, length) {
  return word ? `${word} (${length})` : 'none'
}

function formatNumber(value, digits = 1) {
  return value.toLocaleString('en-GB', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

function formatPercent(value) {
  return `${formatNumber(value * 100, 1)}%`
}

function formatSeconds(ms) {
  return `${formatNumber(ms / 1000, 1)}s`
}

function printHelp() {
  console.log(`
Usage:
  npm run analyze:cubes -- [options]

Options:
  --runs N             Number of cube seeds to analyse. Default: 100
  --seed N             First seed. Subsequent runs use seed + index. Default: 12345
  --min N              Minimum word length. Default: 4
  --starter-max N      Max starter word length for popular-word accessibility. Default: 5
  --long-max N         Max word length for long-word search. Default: 12
  --perfect-runs N     Optional state-capped perfect-play search. Default: 0
  --perfect-states N   State cap per perfect-play cube. Default: 5000
  --show-starters N    Debug: list exposed popular starter words of length N per cube.
  --show-starters-limit N
                       Debug: number of cubes to list. Default: 10
  --weights A:9,E:11   Override the letter bag.
  --json               Print machine-readable output.
`)
}
