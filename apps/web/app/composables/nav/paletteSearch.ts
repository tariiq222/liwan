// Relative import: this module is unit-tested directly under plain vitest.
import { foldForIndex } from '../../utils/searchFold'

/**
 * The palette's Fuse wiring, kept out of the component so the fold can be tested without mounting it.
 *
 * Fuse scores on the raw string, so folding only the index makes the search fail on the correct spelling: the stored
 * «مهمة» becomes «مهمه» while the typed «مهمة» stays as it was, and the two no longer match. Both sides therefore go
 * through {@link foldForIndex}: every field Fuse indexes, and the term the user types.
 */

/** The text Fuse indexes for one field: a non-string field indexes as empty rather than as `undefined`. */
export function paletteIndexText(item: Record<string, unknown>, path: string | string[]): string {
  const field = Array.isArray(path) ? path[0] : path
  const value = field === undefined ? undefined : item[field]
  return typeof value === 'string' ? foldForIndex(value) : ''
}

/** The term the palette searches with, folded exactly like the index it is matched against. */
export function paletteSearchTerm(term: string): string {
  return foldForIndex(term)
}
