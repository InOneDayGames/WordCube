import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { countLetters, countVowels } from '../.tmp_sim/src/cube.js'
import { createCubeForSeed, createWordData, enumerateWordOpportunities } from '../.tmp_sim/src/cubeOpportunities.js'

const DAILY_PUZZLE_TIME_ZONE = 'Europe/London'
const DEFAULT_INTERVAL_HOURS = 24
const DEFAULT_SALT = 'word-cube:curation:v1'
const MANIFEST_PATH = resolve(process.cwd(), 'public', 'daily-puzzles.json')
const RARE_LETTERS = new Set(['J', 'Q', 'X', 'Z'])

const options = normalizeOptions(parseArgs(process.argv.slice(2)))
const dictionaryWords = readWordList(resolve(process.cwd(), 'public', 'dictionary.txt'))
const legalWordSet = new Set(dictionaryWords)
const rawPopularWords = readWordList(resolve(process.cwd(), 'public', 'popular.txt'))
const legalPopularWords = rawPopularWords.filter((word) => legalWordSet.has(word))
const legalWordData = createWordData(dictionaryWords, 4)
const popularWordData = createWordData(legalPopularWords, 4)
const manifest = readDailyPuzzleManifest()

if (options.reportManifest) {
  printManifestLongWordPersistenceReport(manifest, options)
} else {
  const dateKeys = createDateKeys(options)
  const results = dateKeys.map((dateKey) => curateDateKey(dateKey, options))

  printReport(results, options)

  if (options.write) {
    writeManifest(results, manifest, options)
  } else {
    console.log('')
    console.log('Dry run only. Re-run with --write to update public/daily-puzzles.json.')
  }
}

function curateDateKey(dateKey, runOptions) {
  const candidates = []

  for (let index = 0; index < runOptions.candidates; index += 1) {
    const seed = hashStringToSeed(`${runOptions.salt}:${dateKey}:${index}`)
    candidates.push(analyzeCandidate(dateKey, seed, index))
  }

  const passed = candidates.filter((candidate) => candidate.passed)
  const ranked = [...passed].sort(compareCandidates)
  const fallbackRanked = [...candidates].sort(compareCandidates)

  return {
    dateKey,
    label: formatDateKeyLabel(dateKey),
    candidates,
    passed,
    winner: ranked[0] ?? fallbackRanked[0] ?? null,
    shortlist: ranked.slice(0, runOptions.shortlist),
    fallbackShortlist: ranked.length === 0 ? fallbackRanked.slice(0, runOptions.shortlist) : [],
  }
}

function analyzeCandidate(dateKey, seed, candidateIndex) {
  const cube = createCubeForSeed(seed)
  const popularShortWords = uniqueWords(enumerateWordOpportunities(cube, popularWordData, 4, 5))
  const popularFiveWords = popularShortWords.filter((word) => word.length === 5)
  const legalSurfaceWords = uniqueWords(enumerateWordOpportunities(cube, legalWordData, 4, 9))
  const legalWordsByLength = countWordsByLength(legalSurfaceWords, 4, 9)
  const longSurfaceCount = sumLengths(legalWordsByLength, 6, 9)
  const longestSurfaceWord = chooseLongestWord(legalSurfaceWords)
  const letterCounts = countLetters(cube)
  const vowelCount = countVowels(cube)
  const rareLetterCount = [...letterCounts.entries()]
    .filter(([letter]) => RARE_LETTERS.has(letter))
    .reduce((sum, [, count]) => sum + count, 0)
  const uniqueLetterCount = [...letterCounts.values()].filter((count) => count > 0).length
  const metrics = {
    popularStarterCount: popularShortWords.length,
    popularFiveCount: popularFiveWords.length,
    longSurfaceCount,
    longestSurfaceWord: longestSurfaceWord.word || null,
    longestSurfaceLength: longestSurfaceWord.length,
    legalWordsByLength,
    vowelCount,
    uniqueLetterCount,
    rareLetterCount,
  }
  const rejectReasons = getRejectReasons(metrics, options)

  return {
    dateKey,
    candidateIndex,
    seed,
    id: seedToGameId(seed),
    label: formatDateKeyLabel(dateKey),
    score: scoreCandidate(metrics),
    passed: rejectReasons.length === 0,
    rejectReasons,
    metrics,
    examples: {
      popularFive: popularFiveWords.sort((a, b) => a.localeCompare(b)).slice(0, 10),
      longestSurface: longestSurfaceWord.word || null,
      longSurface: legalSurfaceWords
        .filter((word) => word.length >= 6)
        .sort((a, b) => b.length - a.length || a.localeCompare(b))
        .slice(0, 10),
    },
  }
}

function getRejectReasons(metrics, runOptions) {
  const reasons = []

  if (metrics.popularStarterCount < runOptions.minStarters) {
    reasons.push(`starter count ${metrics.popularStarterCount} < ${runOptions.minStarters}`)
  }

  if (metrics.popularFiveCount < runOptions.minFive) {
    reasons.push(`5-letter starters ${metrics.popularFiveCount} < ${runOptions.minFive}`)
  }

  if (metrics.longSurfaceCount < runOptions.minLongSurface) {
    reasons.push(`6-9 letter legal surface words ${metrics.longSurfaceCount} < ${runOptions.minLongSurface}`)
  }

  if (metrics.longestSurfaceLength < runOptions.minLongest) {
    reasons.push(`longest surface word ${metrics.longestSurfaceLength} < ${runOptions.minLongest}`)
  }

  if (metrics.vowelCount < runOptions.minVowels || metrics.vowelCount > runOptions.maxVowels) {
    reasons.push(`vowels ${metrics.vowelCount} outside ${runOptions.minVowels}-${runOptions.maxVowels}`)
  }

  if (metrics.uniqueLetterCount < runOptions.minUnique) {
    reasons.push(`unique letters ${metrics.uniqueLetterCount} < ${runOptions.minUnique}`)
  }

  if (metrics.rareLetterCount > runOptions.maxRare) {
    reasons.push(`rare letters ${metrics.rareLetterCount} > ${runOptions.maxRare}`)
  }

  return reasons
}

function scoreCandidate(metrics) {
  const lengthCounts = metrics.legalWordsByLength

  return (
    metrics.popularStarterCount * 1.2 +
    metrics.popularFiveCount * 3.2 +
    (lengthCounts.get(6) ?? 0) * 2.5 +
    (lengthCounts.get(7) ?? 0) * 4.5 +
    (lengthCounts.get(8) ?? 0) * 7 +
    (lengthCounts.get(9) ?? 0) * 10 +
    metrics.longestSurfaceLength * 7 +
    metrics.uniqueLetterCount * 0.6 -
    Math.abs(metrics.vowelCount - 60) * 0.35 -
    Math.max(0, metrics.rareLetterCount - 4) * 1.5
  )
}

function compareCandidates(a, b) {
  return (
    Number(b.passed) - Number(a.passed) ||
    b.score - a.score ||
    b.metrics.longestSurfaceLength - a.metrics.longestSurfaceLength ||
    b.metrics.popularFiveCount - a.metrics.popularFiveCount ||
    b.metrics.popularStarterCount - a.metrics.popularStarterCount ||
    a.seed - b.seed
  )
}

function printReport(results, runOptions) {
  console.log('Word Cube daily curation')
  console.log('========================')
  console.log(
    `Slots: ${results.length}; candidates per slot: ${runOptions.candidates}; ` +
      `interval: ${runOptions.intervalHours}h; mode: ${runOptions.write ? 'write' : 'dry run'}`,
  )
  console.log(
    `Gates: starters >= ${runOptions.minStarters}, 5-letter starters >= ${runOptions.minFive}, ` +
      `6-9 letter words >= ${runOptions.minLongSurface}, longest >= ${runOptions.minLongest}, ` +
      `vowels ${runOptions.minVowels}-${runOptions.maxVowels}, unique >= ${runOptions.minUnique}, rare <= ${runOptions.maxRare}`,
  )

  for (const result of results) {
    console.log('')
    console.log(`${result.dateKey} (${result.label})`)
    console.log('-'.repeat(result.dateKey.length + result.label.length + 3))
    console.log(`Passed gates: ${result.passed.length}/${result.candidates.length}`)

    if (!result.winner) {
      console.log('No candidates generated.')
      continue
    }

    console.log(`Winner: ${formatCandidate(result.winner)}`)

    if (!result.winner.passed) {
      console.log(`  Fallback only; failed gates: ${result.winner.rejectReasons.join('; ')}`)
    }

    const shortlist = result.shortlist.length > 0 ? result.shortlist : result.fallbackShortlist

    console.log('Shortlist:')
    shortlist.forEach((candidate, index) => {
      console.log(`  ${index + 1}. ${formatCandidate(candidate)}`)
      console.log(`     Examples: ${formatExamples(candidate)}`)
    })
  }
}

function formatCandidate(candidate) {
  const byLength = formatLengthCounts(candidate.metrics.legalWordsByLength, 6, 9)

  return (
    `seed ${candidate.seed} (${candidate.id}), score ${formatNumber(candidate.score)}, ` +
    `popular 4-5 ${candidate.metrics.popularStarterCount}, 5L ${candidate.metrics.popularFiveCount}, ` +
    `6-9 ${candidate.metrics.longSurfaceCount} [${byLength}], ` +
    `longest ${candidate.metrics.longestSurfaceWord ?? 'none'} (${candidate.metrics.longestSurfaceLength}), ` +
    `vowels ${candidate.metrics.vowelCount}, unique ${candidate.metrics.uniqueLetterCount}, rare ${candidate.metrics.rareLetterCount}`
  )
}

function formatExamples(candidate) {
  const five = candidate.examples.popularFive.length > 0 ? candidate.examples.popularFive.join(', ') : 'none'
  const long = candidate.examples.longSurface.length > 0 ? candidate.examples.longSurface.join(', ') : 'none'

  return `5L ${five}; long ${long}`
}

function printManifestLongWordPersistenceReport(manifest, runOptions) {
  const entries = getManifestReportEntries(manifest).slice(-runOptions.reportLast)

  console.log('Word Cube long-word persistence experiment')
  console.log('===========================================')
  console.log(
    `Manifest entries: ${entries.length}; opening moves: unique popular 4-5 letter removal states; ` +
      `target: popular and legal ${runOptions.reportLongMin}-${runOptions.reportLongMax} letter surface words.`,
  )
  console.log(
    `Dig curve: depth ${runOptions.reportDepth}, branch limit ${runOptions.reportBranchLimit}, ` +
      `state limit ${runOptions.reportStateLimit}.`,
  )

  if (entries.length === 0) {
    console.log('')
    console.log('No manifest entries found.')
    return
  }

  for (const entry of entries) {
    printLongWordPersistenceEntry(entry, analyzeLongWordPersistence(entry, runOptions), runOptions)
  }
}

function getManifestReportEntries(manifest) {
  return Object.entries(manifest.puzzles)
    .map(([dateKey, entry]) => {
      const seed = parseManifestSeed(entry?.seed)

      if (seed === null) {
        return null
      }

      return {
        dateKey,
        label: typeof entry.label === 'string' ? entry.label : formatDateKeyLabel(dateKey),
        seed,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
}

function parseManifestSeed(value) {
  const seed = typeof value === 'number' ? value : Number(value)

  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return null
  }

  return seed >>> 0
}

function analyzeLongWordPersistence(entry, runOptions) {
  const cube = createCubeForSeed(entry.seed)
  const startingPopularLongWords = analyzeLongSurfaceWords(cube, popularWordData, runOptions)
  const startingLegalLongWords = analyzeLongSurfaceWords(cube, legalWordData, runOptions)
  const openings = getOpeningRemovalStates(cube)
  const openingAnalyses = openings.map((opening) => {
    const followUpCube = removeBlocks(cube, opening.blockIds)
    const followUpPopularLongWords = analyzeLongSurfaceWords(followUpCube, popularWordData, runOptions)
    const followUpLegalLongWords = analyzeLongSurfaceWords(followUpCube, legalWordData, runOptions)
    const newPopularWords = followUpPopularLongWords.words.filter((word) => !startingPopularLongWords.wordSet.has(word))
    const newLegalWords = followUpLegalLongWords.words.filter((word) => !startingLegalLongWords.wordSet.has(word))

    return {
      opening,
      followUpPopularLongWords,
      followUpLegalLongWords,
      newPopularWords,
      newLegalWords,
    }
  })

  return {
    startingPopularLongWords,
    startingLegalLongWords,
    openings,
    openingAnalyses,
    popularSummary: summarizeFollowUpLongWords(openingAnalyses, 'popular'),
    legalSummary: summarizeFollowUpLongWords(openingAnalyses, 'legal'),
    depthCurve: analyzeDigDepthCurve(cube, runOptions),
  }
}

function summarizeFollowUpLongWords(openingAnalyses, dictionaryKind) {
  const totals = openingAnalyses.map((analysis) => getFollowUpLongWords(analysis, dictionaryKind).total)
  const newWordTotals = openingAnalyses.map((analysis) => getNewLongWords(analysis, dictionaryKind).length)

  return {
    average: average(totals),
    median: median(totals),
    worst: totals.length === 0 ? 0 : Math.min(...totals),
    best: totals.length === 0 ? 0 : Math.max(...totals),
    deadOpenings: totals.filter((total) => total === 0).length,
    averageNewWords: average(newWordTotals),
    bestNewWords: newWordTotals.length === 0 ? 0 : Math.max(...newWordTotals),
  }
}

function getOpeningRemovalStates(cube) {
  const opportunities = enumerateWordOpportunities(cube, popularWordData, 4, 5)
  const byRemovalState = new Map()

  for (const opportunity of opportunities) {
    const current = byRemovalState.get(opportunity.removalKey)

    if (!current || compareOpeningRepresentatives(opportunity, current) < 0) {
      byRemovalState.set(opportunity.removalKey, opportunity)
    }
  }

  return [...byRemovalState.values()].sort((a, b) => a.word.localeCompare(b.word) || a.removalKey.localeCompare(b.removalKey))
}

function compareOpeningRepresentatives(a, b) {
  return b.word.length - a.word.length || a.word.localeCompare(b.word)
}

function analyzeDigDepthCurve(cube, runOptions) {
  const depthCurve = []
  let states = [
    {
      cube,
      key: createCubeStateKey(cube),
      path: [],
    },
  ]

  for (let depth = 0; depth <= runOptions.reportDepth; depth += 1) {
    const stateAnalyses = states.map((state) => analyzeDigState(state, runOptions))
    depthCurve.push(summarizeDigDepth(depth, stateAnalyses))

    if (depth === runOptions.reportDepth || states.length === 0) {
      break
    }

    states = expandDigStates(states, runOptions)
  }

  return depthCurve
}

function analyzeDigState(state, runOptions) {
  return {
    state,
    removedBlocks: countRemovedBlocks(state.cube),
    popularLongWords: analyzeLongSurfaceWords(state.cube, popularWordData, runOptions),
    legalLongWords: analyzeLongSurfaceWords(state.cube, legalWordData, runOptions),
  }
}

function summarizeDigDepth(depth, stateAnalyses) {
  const removedBlockCounts = stateAnalyses.map((analysis) => analysis.removedBlocks)

  return {
    depth,
    stateCount: stateAnalyses.length,
    averageRemovedBlocks: average(removedBlockCounts),
    popular: summarizeDigDepthLongWords(stateAnalyses, 'popular'),
    legal: summarizeDigDepthLongWords(stateAnalyses, 'legal'),
  }
}

function summarizeDigDepthLongWords(stateAnalyses, dictionaryKind) {
  const totals = stateAnalyses.map((analysis) => getDigStateLongWords(analysis, dictionaryKind).total)
  const worst = chooseDigDepthExtreme(stateAnalyses, dictionaryKind, 'worst')
  const best = chooseDigDepthExtreme(stateAnalyses, dictionaryKind, 'best')

  return {
    average: average(totals),
    median: median(totals),
    worstCount: worst?.longWords.total ?? 0,
    worstPath: worst?.analysis.state.path ?? [],
    bestCount: best?.longWords.total ?? 0,
    bestPath: best?.analysis.state.path ?? [],
    deadStates: totals.filter((total) => total === 0).length,
  }
}

function chooseDigDepthExtreme(stateAnalyses, dictionaryKind, direction) {
  const sorted = stateAnalyses
    .map((analysis) => ({
      analysis,
      longWords: getDigStateLongWords(analysis, dictionaryKind),
    }))
    .sort((a, b) => {
      const countComparison =
        direction === 'best'
          ? b.longWords.total - a.longWords.total
          : a.longWords.total - b.longWords.total

      return (
        countComparison ||
        (direction === 'best'
          ? b.longWords.longestLength - a.longWords.longestLength
          : a.longWords.longestLength - b.longWords.longestLength) ||
        formatPath(a.analysis.state.path).localeCompare(formatPath(b.analysis.state.path))
      )
    })

  return sorted[0] ?? null
}

function expandDigStates(states, runOptions) {
  const nextStates = new Map()

  for (const state of states) {
    for (const opening of getDigOpenings(state.cube, runOptions)) {
      const childCube = removeBlocks(state.cube, opening.blockIds)
      const key = createCubeStateKey(childCube)

      if (key === state.key) {
        continue
      }

      const child = {
        cube: childCube,
        key,
        path: [...state.path, opening.word],
      }
      const current = nextStates.get(key)

      if (!current || compareDigStateRepresentatives(child, current) < 0) {
        nextStates.set(key, child)
      }
    }
  }

  return [...nextStates.values()]
    .sort(compareDigStateRepresentatives)
    .slice(0, runOptions.reportStateLimit)
}

function getDigOpenings(cube, runOptions) {
  return getOpeningRemovalStates(cube)
    .sort(compareDigOpenings)
    .slice(0, runOptions.reportBranchLimit)
}

function compareDigOpenings(a, b) {
  return (
    b.blockIds.length - a.blockIds.length ||
    b.word.length - a.word.length ||
    a.word.localeCompare(b.word)
  )
}

function compareDigStateRepresentatives(a, b) {
  return (
    countRemovedBlocks(b.cube) - countRemovedBlocks(a.cube) ||
    a.path.length - b.path.length ||
    formatPath(a.path).localeCompare(formatPath(b.path))
  )
}

function analyzeLongSurfaceWords(cube, wordData, runOptions) {
  const words = uniqueWords(enumerateWordOpportunities(cube, wordData, runOptions.reportLongMin, runOptions.reportLongMax))
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
  const byLength = countWordsByLength(words, runOptions.reportLongMin, runOptions.reportLongMax)
  const longest = chooseLongestWord(words)

  return {
    words,
    wordSet: new Set(words),
    total: words.length,
    byLength,
    longestWord: longest.word || null,
    longestLength: longest.length,
  }
}

function removeBlocks(cube, blockIds) {
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

function printLongWordPersistenceEntry(entry, analysis, runOptions) {
  const {
    startingPopularLongWords,
    startingLegalLongWords,
    openingAnalyses,
    popularSummary,
    legalSummary,
  } = analysis

  console.log('')
  console.log(`${entry.dateKey} (${entry.label})`)
  console.log('-'.repeat(entry.dateKey.length + entry.label.length + 3))
  console.log(`Seed: ${entry.seed} (${seedToGameId(entry.seed)})`)
  console.log(formatStartingLongWords('Popular', startingPopularLongWords, runOptions))
  console.log(`Popular examples: ${formatWordExamples(startingPopularLongWords.words, 8)}`)
  console.log(formatStartingLongWords('Legal', startingLegalLongWords, runOptions))
  console.log(`Legal examples: ${formatWordExamples(startingLegalLongWords.words, 8)}`)
  console.log(`Openings tested: ${openingAnalyses.length}`)
  console.log(formatFollowUpSummary('Popular after one opening', popularSummary, openingAnalyses.length))
  console.log(formatFollowUpSummary('Legal after one opening', legalSummary, openingAnalyses.length))
  console.log(`Best popular openings: ${formatOpeningAnalyses(getBestOpeningAnalyses(openingAnalyses, 'popular'), 'popular', runOptions)}`)
  console.log(`Worst popular openings: ${formatOpeningAnalyses(getWorstOpeningAnalyses(openingAnalyses, 'popular'), 'popular', runOptions)}`)
  console.log(`Best legal openings: ${formatOpeningAnalyses(getBestOpeningAnalyses(openingAnalyses, 'legal'), 'legal', runOptions)}`)
  console.log('Popular dig curve:')
  analysis.depthCurve.forEach((depth) => {
    console.log(`  ${formatDigDepthLine(depth, 'popular')}`)
  })
  console.log('Legal dig curve:')
  analysis.depthCurve.forEach((depth) => {
    console.log(`  ${formatDigDepthLine(depth, 'legal')}`)
  })
}

function formatStartingLongWords(label, longWords, runOptions) {
  return (
    `${label} starting long words: ${longWords.total} ` +
    `[${formatLengthCounts(longWords.byLength, runOptions.reportLongMin, runOptions.reportLongMax)}], ` +
    `longest ${longWords.longestWord ?? 'none'} (${longWords.longestLength})`
  )
}

function formatFollowUpSummary(label, summary, openingCount) {
  const deadRate = openingCount === 0 ? 0 : summary.deadOpenings / openingCount

  return (
    `${label}: avg ${formatNumber(summary.average)}, median ${formatNumber(summary.median)}, ` +
    `worst ${summary.worst}, best ${summary.best}, dead ${summary.deadOpenings}/${openingCount} ` +
    `(${formatPercent(deadRate)}), avg new ${formatNumber(summary.averageNewWords)}, best new ${summary.bestNewWords}`
  )
}

function getBestOpeningAnalyses(openingAnalyses, dictionaryKind) {
  return [...openingAnalyses]
    .sort(
      (a, b) =>
        getFollowUpLongWords(b, dictionaryKind).total - getFollowUpLongWords(a, dictionaryKind).total ||
        getFollowUpLongWords(b, dictionaryKind).longestLength - getFollowUpLongWords(a, dictionaryKind).longestLength ||
        getNewLongWords(b, dictionaryKind).length - getNewLongWords(a, dictionaryKind).length ||
        a.opening.word.localeCompare(b.opening.word),
    )
    .slice(0, 3)
}

function getWorstOpeningAnalyses(openingAnalyses, dictionaryKind) {
  return [...openingAnalyses]
    .sort(
      (a, b) =>
        getFollowUpLongWords(a, dictionaryKind).total - getFollowUpLongWords(b, dictionaryKind).total ||
        getFollowUpLongWords(a, dictionaryKind).longestLength - getFollowUpLongWords(b, dictionaryKind).longestLength ||
        a.opening.word.localeCompare(b.opening.word),
    )
    .slice(0, 3)
}

function formatOpeningAnalyses(openingAnalyses, dictionaryKind, runOptions) {
  if (openingAnalyses.length === 0) {
    return 'none'
  }

  return openingAnalyses
    .map((analysis) => {
      const longWords = getFollowUpLongWords(analysis, dictionaryKind)
      const counts = formatLengthCounts(
        longWords.byLength,
        runOptions.reportLongMin,
        runOptions.reportLongMax,
      )

      return (
        `${analysis.opening.word} -> ${longWords.total} ` +
        `[${counts}], longest ${longWords.longestWord ?? 'none'}`
      )
    })
    .join('; ')
}

function getFollowUpLongWords(analysis, dictionaryKind) {
  return dictionaryKind === 'popular' ? analysis.followUpPopularLongWords : analysis.followUpLegalLongWords
}

function getNewLongWords(analysis, dictionaryKind) {
  return dictionaryKind === 'popular' ? analysis.newPopularWords : analysis.newLegalWords
}

function getDigStateLongWords(analysis, dictionaryKind) {
  return dictionaryKind === 'popular' ? analysis.popularLongWords : analysis.legalLongWords
}

function formatDigDepthLine(depth, dictionaryKind) {
  const summary = dictionaryKind === 'popular' ? depth.popular : depth.legal
  const deadRate = depth.stateCount === 0 ? 0 : summary.deadStates / depth.stateCount

  return (
    `D${depth.depth}: states ${depth.stateCount}, removed avg ${formatNumber(depth.averageRemovedBlocks)}, ` +
    `avg ${formatNumber(summary.average)}, median ${formatNumber(summary.median)}, ` +
    `worst ${summary.worstCount} (${formatPath(summary.worstPath)}), ` +
    `best ${summary.bestCount} (${formatPath(summary.bestPath)}), ` +
    `dead ${summary.deadStates}/${depth.stateCount} (${formatPercent(deadRate)})`
  )
}

function countRemovedBlocks(cube) {
  return cube.blocks.filter((block) => block.removed).length
}

function createCubeStateKey(cube) {
  return cube.blocks.map((block) => (block.removed ? '1' : '0')).join('')
}

function formatPath(path) {
  return path.length === 0 ? 'start' : path.join(' > ')
}

function formatWordExamples(words, limit) {
  return words.length === 0 ? 'none' : words.slice(0, limit).join(', ')
}

function writeManifest(results, manifest, runOptions) {
  const nextManifest = {
    puzzles: runOptions.clear ? {} : {
      ...manifest.puzzles,
    },
  }
  const written = []
  const skipped = []

  for (const result of results) {
    if (!result.winner) {
      skipped.push(`${result.dateKey}: no winner`)
      continue
    }

    if (!result.winner.passed && !runOptions.allowFallback) {
      skipped.push(`${result.dateKey}: no passing candidate`)
      continue
    }

    if (!runOptions.replace && Object.prototype.hasOwnProperty.call(nextManifest.puzzles, result.dateKey)) {
      skipped.push(`${result.dateKey}: already exists`)
      continue
    }

    nextManifest.puzzles[result.dateKey] = {
      seed: result.winner.seed,
      label: result.label,
    }
    written.push(result.dateKey)
  }

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`)

  console.log('')
  console.log(`Updated ${MANIFEST_PATH}`)
  console.log(`Written: ${written.length === 0 ? 'none' : written.join(', ')}`)

  if (skipped.length > 0) {
    console.log(`Skipped: ${skipped.join('; ')}`)
  }
}

function readDailyPuzzleManifest() {
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

    if (!parsed || typeof parsed !== 'object' || !parsed.puzzles || typeof parsed.puzzles !== 'object') {
      return { puzzles: {} }
    }

    return {
      puzzles: parsed.puzzles,
    }
  } catch {
    return { puzzles: {} }
  }
}

function readWordList(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((word) => word.trim().toUpperCase())
    .filter((word) => /^[A-Z]+$/.test(word))
}

function uniqueWords(opportunities) {
  return [...new Set(opportunities.map((opportunity) => opportunity.word))]
}

function countWordsByLength(words, minLength, maxLength) {
  const counts = new Map()

  for (let length = minLength; length <= maxLength; length += 1) {
    counts.set(length, 0)
  }

  for (const word of words) {
    counts.set(word.length, (counts.get(word.length) ?? 0) + 1)
  }

  return counts
}

function sumLengths(counts, minLength, maxLength) {
  let total = 0

  for (let length = minLength; length <= maxLength; length += 1) {
    total += counts.get(length) ?? 0
  }

  return total
}

function chooseLongestWord(words) {
  return words.reduce(
    (best, word) => {
      if (word.length > best.length) {
        return { word, length: word.length }
      }

      if (word.length === best.length && (!best.word || word.localeCompare(best.word) < 0)) {
        return { word, length: word.length }
      }

      return best
    },
    { word: '', length: 0 },
  )
}

function createDateKeys(runOptions) {
  const startKey = runOptions.startKey ?? getSlotDateKey(new Date(), runOptions.intervalHours)
  const keys = []
  let current = startKey

  while (keys.length < runOptions.slots) {
    keys.push(current)
    current = addHoursToDateKey(current, runOptions.intervalHours)
  }

  return keys
}

function getSlotDateKey(date, intervalHours) {
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

  if (intervalHours >= 24) {
    return `${year}-${month}-${day}`
  }

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const slotHour = Math.floor(hour / intervalHours) * intervalHours

  return `${year}-${month}-${day}T${String(slotHour).padStart(2, '0')}`
}

function addHoursToDateKey(dateKey, hours) {
  const [datePart, hourPart = '00'] = dateKey.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, Number(hourPart), 0, 0, 0))
  date.setUTCHours(date.getUTCHours() + hours)

  const nextDatePart = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`

  if (hours >= 24 && !dateKey.includes('T')) {
    return nextDatePart
  }

  return `${nextDatePart}T${String(date.getUTCHours()).padStart(2, '0')}`
}

function formatDateKeyLabel(dateKey) {
  const [datePart, slotHour] = dateKey.split('T')
  const [year, month, day] = datePart.split('-')
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthIndex = Number(month) - 1
  const dateLabel = `${Number(day)} ${monthLabels[monthIndex] ?? month} ${year.slice(-2)}`

  return slotHour === undefined ? dateLabel : `${dateLabel}, ${slotHour}:00`
}

function parseArgs(args) {
  const parsedOptions = {
    slots: 12,
    candidates: 500,
    shortlist: 3,
    startKey: null,
    intervalHours: DEFAULT_INTERVAL_HOURS,
    salt: DEFAULT_SALT,
    minStarters: 15,
    minFive: 2,
    minLongSurface: 1,
    minLongest: 7,
    minVowels: 45,
    maxVowels: 75,
    minUnique: 20,
    maxRare: 8,
    reportManifest: false,
    reportLast: 10,
    reportLongMin: 7,
    reportLongMax: 9,
    reportDepth: 4,
    reportBranchLimit: 12,
    reportStateLimit: 80,
    write: false,
    replace: false,
    allowFallback: false,
    clear: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]

    switch (arg) {
      case '--slots':
        parsedOptions.slots = Number(next)
        index += 1
        break
      case '--candidates':
        parsedOptions.candidates = Number(next)
        index += 1
        break
      case '--shortlist':
        parsedOptions.shortlist = Number(next)
        index += 1
        break
      case '--start-key':
        parsedOptions.startKey = next
        index += 1
        break
      case '--interval-hours':
        parsedOptions.intervalHours = Number(next)
        index += 1
        break
      case '--salt':
        parsedOptions.salt = next
        index += 1
        break
      case '--min-starters':
        parsedOptions.minStarters = Number(next)
        index += 1
        break
      case '--min-five':
        parsedOptions.minFive = Number(next)
        index += 1
        break
      case '--min-long-surface':
        parsedOptions.minLongSurface = Number(next)
        index += 1
        break
      case '--min-longest':
        parsedOptions.minLongest = Number(next)
        index += 1
        break
      case '--min-vowels':
        parsedOptions.minVowels = Number(next)
        index += 1
        break
      case '--max-vowels':
        parsedOptions.maxVowels = Number(next)
        index += 1
        break
      case '--min-unique':
        parsedOptions.minUnique = Number(next)
        index += 1
        break
      case '--max-rare':
        parsedOptions.maxRare = Number(next)
        index += 1
        break
      case '--report-manifest':
        parsedOptions.reportManifest = true
        break
      case '--last':
        parsedOptions.reportLast = Number(next)
        index += 1
        break
      case '--report-long-min':
        parsedOptions.reportLongMin = Number(next)
        index += 1
        break
      case '--report-long-max':
        parsedOptions.reportLongMax = Number(next)
        index += 1
        break
      case '--report-depth':
        parsedOptions.reportDepth = Number(next)
        index += 1
        break
      case '--report-branch-limit':
        parsedOptions.reportBranchLimit = Number(next)
        index += 1
        break
      case '--report-state-limit':
        parsedOptions.reportStateLimit = Number(next)
        index += 1
        break
      case '--write':
        parsedOptions.write = true
        break
      case '--replace':
        parsedOptions.replace = true
        break
      case '--allow-fallback':
        parsedOptions.allowFallback = true
        break
      case '--clear':
        parsedOptions.clear = true
        break
      case '--help':
        printHelp()
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsedOptions
}

function normalizeOptions(rawOptions) {
  assertPositiveInteger(rawOptions.slots, '--slots')
  assertPositiveInteger(rawOptions.candidates, '--candidates')
  assertPositiveInteger(rawOptions.shortlist, '--shortlist')
  assertPositiveInteger(rawOptions.intervalHours, '--interval-hours')
  assertPositiveInteger(rawOptions.minStarters, '--min-starters')
  assertPositiveInteger(rawOptions.minFive, '--min-five')
  assertPositiveInteger(rawOptions.minLongSurface, '--min-long-surface')
  assertPositiveInteger(rawOptions.minLongest, '--min-longest')
  assertPositiveInteger(rawOptions.minVowels, '--min-vowels')
  assertPositiveInteger(rawOptions.maxVowels, '--max-vowels')
  assertPositiveInteger(rawOptions.minUnique, '--min-unique')
  assertPositiveInteger(rawOptions.maxRare, '--max-rare')
  assertPositiveInteger(rawOptions.reportLast, '--last')
  assertPositiveInteger(rawOptions.reportLongMin, '--report-long-min')
  assertPositiveInteger(rawOptions.reportLongMax, '--report-long-max')
  assertPositiveInteger(rawOptions.reportDepth, '--report-depth')
  assertPositiveInteger(rawOptions.reportBranchLimit, '--report-branch-limit')
  assertPositiveInteger(rawOptions.reportStateLimit, '--report-state-limit')

  if (rawOptions.startKey !== null && !/^\d{4}-\d{2}-\d{2}(?:T\d{2})?$/.test(rawOptions.startKey)) {
    throw new Error('--start-key must look like 2026-04-12 or 2026-04-12T14')
  }

  if (rawOptions.intervalHours < 1 || rawOptions.intervalHours > 24 || 24 % rawOptions.intervalHours !== 0) {
    throw new Error('--interval-hours must be a factor of 24')
  }

  if (rawOptions.minVowels > rawOptions.maxVowels) {
    throw new Error('--min-vowels must be less than or equal to --max-vowels')
  }

  if (rawOptions.reportLongMin > rawOptions.reportLongMax) {
    throw new Error('--report-long-min must be less than or equal to --report-long-max')
  }

  if (rawOptions.reportBranchLimit < 1) {
    throw new Error('--report-branch-limit must be at least 1')
  }

  if (rawOptions.reportStateLimit < 1) {
    throw new Error('--report-state-limit must be at least 1')
  }

  return rawOptions
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
}

function hashStringToSeed(value) {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

function seedToGameId(seed) {
  return (seed >>> 0).toString(36).toUpperCase().padStart(7, '0')
}

function formatLengthCounts(counts, minLength, maxLength) {
  const chunks = []

  for (let length = minLength; length <= maxLength; length += 1) {
    chunks.push(`${length}L ${counts.get(length) ?? 0}`)
  }

  return chunks.join(', ')
}

function formatNumber(value) {
  return value.toLocaleString('en-GB', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })
}

function average(values) {
  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values) {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function formatPercent(value) {
  return value.toLocaleString('en-GB', {
    maximumFractionDigits: 0,
    style: 'percent',
  })
}

function printHelp() {
  console.log(`
Usage:
  npm run curate:dailies -- [options]

Options:
  --slots N              Number of puzzle slots to curate. Default: 12
  --candidates N         Candidate seeds to test per slot. Default: 500
  --shortlist N          Candidate shortlist to print per slot. Default: 3
  --start-key KEY        First slot key, e.g. 2026-04-12. Default: current London slot
  --interval-hours N     Slot interval. Default: 24
  --salt TEXT            Deterministic candidate seed salt.
  --min-starters N       Minimum popular 4-5 letter surface words. Default: 15
  --min-five N           Minimum popular 5-letter surface words. Default: 2
  --min-long-surface N   Minimum legal 6-9 letter surface words. Default: 1
  --min-longest N        Minimum longest legal surface word length. Default: 7
  --min-vowels N         Minimum cube vowels. Default: 45
  --max-vowels N         Maximum cube vowels. Default: 75
  --min-unique N         Minimum unique cube letters. Default: 20
  --max-rare N           Maximum J/Q/X/Z faces. Default: 8
  --report-manifest      Read existing manifest and report long-word persistence only.
  --last N               Manifest report: number of latest entries to analyse. Default: 10
  --report-long-min N    Manifest report: minimum long-word length. Default: 7
  --report-long-max N    Manifest report: maximum long-word length. Default: 9
  --report-depth N       Manifest report: simulated popular-word dig depth. Default: 4
  --report-branch-limit N
                          Manifest report: short-word removals sampled per state. Default: 12
  --report-state-limit N Manifest report: unique states retained per depth. Default: 80
  --write                Update public/daily-puzzles.json.
  --replace              Replace existing manifest entries when writing.
  --allow-fallback       Write the best candidate even if no candidate passes all gates.
  --clear                Clear existing manifest entries before writing.
`)
}
