/**
 * Word list handling. The engine and solver never load files themselves — they
 * take an `isWord` predicate — so the same code runs in the browser and in the
 * offline baking scripts.
 */

/** @param {string} text */
export function parseWordList(text) {
  return text
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * A dictionary also knows every prefix of every word it holds, which lets the
 * solver prune whole branches of the state space instead of testing all 7,776
 * positions letter by letter.
 *
 * @param {Iterable<string>} words
 */
export function createDictionary(words) {
  const list = [...words].map((word) => word.toLowerCase());
  const set = new Set(list);
  const prefixes = new Set();
  for (const word of set) {
    for (let length = 1; length < word.length; length += 1) prefixes.add(word.slice(0, length));
  }
  return {
    has: (word) => set.has(String(word).toLowerCase()),
    /** True if any word in the list starts with `prefix`. */
    hasPrefix: (prefix) => prefixes.has(String(prefix).toLowerCase()),
    get size() {
      return set.size;
    },
    list,
  };
}

export const WORD_FILES = {
  /** Everything the game accepts as a word. */
  valid: 'data/valid5.txt',
  /** The much smaller, frequency-ordered pool solutions are drawn from. */
  answers: 'data/answers5.txt',
};

/**
 * Browser loader.
 * @param {string} base URL prefix, e.g. '' or './'
 */
export async function loadWordLists(base = '') {
  const [validText, answersText] = await Promise.all(
    [WORD_FILES.valid, WORD_FILES.answers].map(async (path) => {
      const response = await fetch(base + path);
      if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
      return response.text();
    }),
  );
  return {
    valid: createDictionary(parseWordList(validText)),
    answers: parseWordList(answersText),
  };
}
