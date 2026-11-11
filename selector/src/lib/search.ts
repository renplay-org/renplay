import uFuzzy from '@leeoniya/ufuzzy'

type Searchable = { title: string; developer?: string | null }

/** How a game matched, best first: a lower tier ranks higher. The title, then the developer, then the tags. */
export type Hit = {
  tier: number
  /** The matched letters of the title as from, to pairs, in the title as written. */
  marks: number[]
}

/** The tiers of a field: equals, starts with, a word starts with, contains, one typo. */
const TITLE = 0
const DEVELOPER = 5
const TAG_WORD = 10
const TAG_START = 11
/** Typos need a word of at least four letters, anything shorter only matches the start of a word. */
const TYPO_FROM = 4
const INSIDE_FROM = 3
const MOST_WORDS = 6

// uFuzzy's own numbers for these modes (its enums are types only): a word must start at a space or a mark, and one error is tolerated.
const STRICT = 2
const SINGLE_ERROR = 1
const LETTERS = {
  unicode: true,
  interSplit: "[^\\p{L}\\d']+",
  intraSplit: '\\p{Ll}\\p{Lu}',
  interBound: '[^\\p{L}\\d]',
  intraBound: '\\p{L}\\d|\\d\\p{L}|\\p{Ll}\\p{Lu}',
  intraChars: "[\\p{L}\\d']",
  intraContr: "'\\p{L}{1,2}\\b",
}
/** A word of the query at the start of a word of the text. */
const atWordStart = new uFuzzy({ ...LETTERS, interLft: STRICT })
/** A word of the query anywhere in the text. */
const inside = new uFuzzy(LETTERS)
/** A word of the query with one wrong, missing, extra or swapped letter, from the start of a word. */
const withTypo = new uFuzzy({ ...LETTERS, interLft: STRICT, intraMode: SINGLE_ERROR, intraSub: 1, intraTrn: 1, intraDel: 1, intraIns: 1 })

const MARKS = /\p{M}/gu
const WORD = /[\p{L}\d']+/gu
/** Letters that stay as written after the accents come off: only their size changes. */
const fit = (text: string, like: string) => (text.length === like.length ? text : text.length > like.length ? text.slice(0, like.length) : text + like.slice(text.length))

/**
 * Lower case without accents, one character for one character, so a place in the result is a place in the
 * text as written ("Pokémon" and "pokemon" are the same, and a match in one marks the letters of the other).
 */
export function normalize(text: string): string {
  let out = ''
  for (const ch of text) {
    if (ch < '\u0080') out += ch.toLowerCase()
    else out += fit(uFuzzy.latinize(ch.normalize('NFD').replace(MARKS, '')).toLowerCase(), ch)
  }
  return out
}

/** The words of a normalized text. */
const wordsOf = (text: string): string[] => text.match(WORD) ?? []

/** What a phrase of the query is to a whole text: equals, starts with, starts a word, is inside it. */
function phraseTier(flat: string, phrase: string): number {
  if (!flat || !phrase) return Infinity
  if (flat === phrase) return 0
  if (flat.startsWith(phrase)) return 1
  if (flat.includes(` ${phrase}`)) return 2
  return phrase.length >= INSIDE_FROM && flat.includes(phrase) ? 3 : Infinity
}

type Found = { tier: number; marks: number[] }

/** Where one word of the query is in a list of texts: the tier and the matched letters of each text it is in. */
function find(texts: string[], word: string): Map<number, Found> {
  const found = new Map<number, Found>()
  const take = (engine: uFuzzy, tier: (at: number, text: string) => number) => {
    const [idxs, info] = engine.search(texts, word, 0, texts.length + 1)
    if (!idxs?.length || !info?.idx) return
    info.idx.forEach((index, n) => {
      if (found.has(index)) return
      found.set(index, { tier: tier(info.start[n]!, texts[index]!), marks: info.ranges[n] ?? [] })
    })
  }
  take(atWordStart, (at, text) => (text === word ? 0 : at === 0 ? 1 : 2))
  if (word.length >= INSIDE_FROM) take(inside, () => 3)
  if (word.length >= TYPO_FROM) take(withTypo, () => 4)
  return found
}

/** Joins ranges that touch or overlap, in order. */
function joined(ranges: number[][]): number[] {
  const pairs: [number, number][] = []
  for (const r of ranges) for (let i = 0; i < r.length; i += 2) pairs.push([r[i]!, r[i + 1]!])
  pairs.sort((a, b) => a[0] - b[0])
  const out: number[] = []
  for (const [from, to] of pairs) {
    const last = out.length - 1
    if (last > 0 && from <= out[last]!) out[last] = Math.max(out[last]!, to)
    else out.push(from, to)
  }
  return out
}

/**
 * Searching a list of games by what a person types. Each word typed must match in the title, the developer or
 * the tags, in any order. A game ranks by its worst word, best first: the title equals the text, starts with it,
 * has a word that starts with it, contains it, or has it with one typo, then the same for the developer, then the
 * tags (a whole word, or the start of a word from three letters). One or two letters only start a word, and a
 * tag never matches from fewer than three. The caller orders games with the same tier.
 */
export function createSearch<T extends Searchable>(games: readonly T[], tagLabels: (game: T) => string[]) {
  const titles = games.map((g) => normalize(g.title))
  const developers = games.map((g) => normalize(g.developer ?? ''))
  const flat = (texts: string[]) => texts.map((t) => wordsOf(t).join(' '))
  const flatTitles = flat(titles)
  const flatDevelopers = flat(developers)
  const tags = games.map((g) => wordsOf(normalize(tagLabels(g).join(' '))))
  return {
    /** The games that match, with how well, or null when the text has no words to search for. */
    find(text: string): Map<T, Hit> | null {
      const words = wordsOf(normalize(text)).slice(0, MOST_WORDS)
      if (!words.length) return null
      const phrase = words.join(' ')
      const inTitles = words.map((w) => find(titles, w))
      const inDevelopers = words.map((w) => find(developers, w))
      const hits = new Map<T, Hit>()
      games.forEach((game, i) => {
        let worst = 0
        const marks: number[][] = []
        for (let w = 0; w < words.length; w++) {
          const title = inTitles[w]!.get(i)
          const developer = inDevelopers[w]!.get(i)
          const word = words[w]!
          const tag = tags[i]!.includes(word) ? TAG_WORD : word.length >= INSIDE_FROM && tags[i]!.some((t) => t.startsWith(word)) ? TAG_START : Infinity
          const best = Math.min(title ? TITLE + title.tier : Infinity, developer ? DEVELOPER + developer.tier : Infinity, tag)
          if (best === Infinity) return
          worst = Math.max(worst, best)
          if (title) marks.push(title.marks)
        }
        const tier = Math.min(worst, TITLE + phraseTier(flatTitles[i]!, phrase), DEVELOPER + phraseTier(flatDevelopers[i]!, phrase))
        hits.set(game, { tier, marks: joined(marks) })
      })
      return hits
    },
  }
}
