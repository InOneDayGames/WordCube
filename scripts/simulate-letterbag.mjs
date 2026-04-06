import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_LETTER_WEIGHTS } from '../.tmp_sim/src/cube.js'
import { createDictionaryDataWithPreferences, runSimulation } from '../.tmp_sim/src/simulation.js'

const options = parseArgs(process.argv.slice(2))
const dictionaryPath = resolve(process.cwd(), 'public', 'dictionary.txt')
const popularPath = resolve(process.cwd(), 'public', 'popular.txt')
const dictionaryText = readFileSync(dictionaryPath, 'utf8')
const popularText = readFileSync(popularPath, 'utf8')
const dictionary = createDictionaryDataWithPreferences(
  dictionaryText.split(/\r?\n/),
  popularText.split(/\r?\n/),
  options.minWordLength,
)
const summary = runSimulation(dictionary, options)

console.log(JSON.stringify(summary, null, 2))

function parseArgs(args) {
  const options = {
    runs: 100,
    minWordLength: 4,
    maxWordLength: 8,
    letterWeights: DEFAULT_LETTER_WEIGHTS,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]

    switch (arg) {
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
        options.letterWeights = parseWeights(next)
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
