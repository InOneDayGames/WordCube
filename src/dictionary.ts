async function loadWordList(path: string): Promise<Set<string>> {
  const response = await fetch(path)

  if (!response.ok) {
    throw new Error(`Unable to load word list: ${path}`)
  }

  const text = await response.text()

  return new Set(
    text
      .split(/\r?\n/)
      .map((word) => word.trim().toUpperCase())
      .filter((word) => /^[A-Z]{3,}$/.test(word)),
  )
}

export async function loadDictionary(): Promise<Set<string>> {
  return loadWordList('/dictionary.txt')
}

export async function loadPopularDictionary(): Promise<Set<string>> {
  return loadWordList('/popular.txt')
}
