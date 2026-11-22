import { describe, expect, it } from 'vitest'
import Fuse from 'fuse.js'
import { foldForIndex, searchFolded } from '../searchFold'

// The palette folds the index AND the term. This reproduces the old asymmetry to prove the defect, then the fix.
const labels = ['مهمة متأخرة', 'فاتورة العميل', 'فاطمة العلي', 'إعدادات الشركة', 'مستشفى الملك']
const options = (fold: boolean) => ({
  ignoreLocation: true, threshold: 0.1, keys: ['label'], ignoreDiacritics: true,
  getFn: (item: Record<string, unknown>, path: string | string[]) => {
    const field = String(Array.isArray(path) ? path[0] : path)
    return fold ? foldForIndex(String(item[field] ?? '')) : String(item[field] ?? '')
  },
})

function search(term: string, foldTerm: boolean) {
  const fuse = new Fuse(labels.map(label => ({ label })), options(true))
  const q = foldTerm ? foldForIndex(term) : term
  return fuse.search(q).map(r => r.item.label)
}

describe('palette fold', () => {
  it('folds only the index: the correct spelling finds nothing (the defect)', () => {
    expect(search('مهمة', false)).toEqual([])
    expect(search('فاتورة', false)).toEqual([])
  })

  it('folds both sides: the correct spelling and the loose one both find it', () => {
    expect(search('مهمة', true)).toEqual(['مهمة متأخرة'])
    expect(search('مهمه', true)).toEqual(['مهمة متأخرة'])
    expect(search('فاتورة', true)).toEqual(['فاتورة العميل'])
    expect(search('اعدادات', true)).toEqual(['إعدادات الشركة'])
  })

  it('keeps the non-search filter consistent for the app search too', () => {
    expect(searchFolded('مهمة متأخرة', 'مهمه')).toBe(true)
  })
})
