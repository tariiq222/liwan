/**
 * Arabic-aware search folding.
 *
 * A user typing «اعدادات» expects «إعدادات», and «مهمه» expects «مهمة». Arabic writes the same word with different
 * hamza carriers (أ إ آ ا), different letter shapes (ة ه, ى ي) and optional diacritics, so a plain lowercase compare
 * matches almost none of the real spellings. This folds both the needle and the haystack to one form before comparing,
 * which is what makes the palette find a record whose name uses the other spelling.
 *
 * It is deliberately lossless in one direction only: several spellings map to one key, so the comparison is more
 * forgiving, and nothing that differs in meaning maps together (it never removes a letter, only unifies variants).
 */
const ARABIC_FOLD: ReadonlyArray<readonly [RegExp, string]> = [
  // Diacritics (fatha, damma, kasra, shadda, sukun, tanwin) and the tatweel: written, never typed in a search box.
  [/[\u064B-\u0652\u0670\u0640]/g, ''],
  // Alef with any hamza, and the bare alef, all fold to the bare alef.
  [/[\u0622\u0623\u0625\u0671]/g, '\u0627'],
  // Alef maqsura folds to ya, and ta marbuta folds to ha: both are the same word to a reader.
  [/\u0649/g, '\u064A'],
  [/\u0629/g, '\u0647'],
  // Hamza on its own carrier and the waw/ya hamza forms fold to their base letter in a search.
  [/\u0624/g, '\u0648'],
  [/\u0626/g, '\u064A'],
]

/** Folds a string for comparison: Arabic variants unified, diacritics dropped, Latin lowercased. */
export function foldForSearch(value: string): string {
  let folded = value
  for (const [pattern, replacement] of ARABIC_FOLD) folded = folded.replace(pattern, replacement)
  return folded.toLocaleLowerCase()
}

/** Whether `haystack` contains `needle` under {@link foldForSearch}; an empty needle matches everything. */
export function searchFolded(haystack: string, needle: string): boolean {
  if (!needle) return true
  return foldForSearch(haystack).includes(foldForSearch(needle))
}

/**
 * The same fold for a fuzzy index: Fuse scores on the raw string, so the palette indexed «إعدادات» and could not be
 * reached by «اعدادات» even though the app search filtered it. `ignoreDiacritics` covers the harakat; this covers the
 * hamza carriers and the letter shapes Fuse does not know about.
 */
export function foldForIndex(value: string): string {
  return foldForSearch(value)
}
