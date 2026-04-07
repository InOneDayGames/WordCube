async function loadWordList(path: string): Promise<Set<string>> {
  const url = new URL(path, document.baseURI).toString()
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Unable to load word list: ${url}`)
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
  return loadWordList('dictionary.txt')
}

export async function loadPopularDictionary(): Promise<Set<string>> {
  return loadWordList('popular.txt')
}
