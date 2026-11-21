import { describe, expect, it } from 'vitest'
import { foldForIndex, foldForSearch, searchFolded } from '../searchFold'

// Arabic writes one word several ways: the hamza may sit on any carrier, ta marbuta and ha both close a word, and the
// diacritics are usually left out. A search box that compares raw characters matches almost none of the real
// spellings, which is what these tests hold.
describe('Arabic search folding', () => {
  it.each([
    ['اعدادات', 'إعدادات'],
    ['انشاء', 'إنشاء'],
    ['اختبار', 'إختبار'],
    ['مهمه', 'مهمة'],
    ['مصطفي', 'مصطفى'],
    ['فاطمه', 'فاطمة'],
  ])('matches %s against %s', (typed, stored) => {
    expect(searchFolded(stored, typed)).toBe(true)
    expect(searchFolded(typed, stored)).toBe(true)
  })

  it('drops the diacritics and the tatweel a reader never types', () => {
    expect(searchFolded('مُحَمَّد', 'محمد')).toBe(true)
    expect(searchFolded('مـــحمد', 'محمد')).toBe(true)
    expect(foldForSearch('مُحَمَّد')).toBe('محمد')
  })

  it('still distinguishes words that differ in a real letter', () => {
    // «مسؤل» and «مسؤول» differ by a whole letter, not by a hamza carrier: they are not two spellings of one word.
    expect(searchFolded('مسؤول', 'مسؤل')).toBe(false)
    // Folding must not erase meaning: these are different words, not two spellings of one.
    expect(searchFolded('مال', 'ميل')).toBe(false)
    expect(searchFolded('كتب', 'كتاب')).toBe(false)
  })

  it('keeps the Latin lowercase it inherited', () => {
    expect(searchFolded('Settings', 'sett')).toBe(true)
    expect(foldForSearch('INVOICE')).toBe('invoice')
  })

  it('matches everything on an empty needle', () => {
    expect(searchFolded('أي شيء', '')).toBe(true)
    expect(searchFolded('', '')).toBe(true)
  })

  it('folds the same way for the fuzzy index', () => {
    expect(foldForIndex('إعدادات')).toBe(foldForSearch('إعدادات'))
    expect(foldForIndex('مُهمَّة')).toBe('مهمه')
  })

  it('finds a record whose label uses the folded form', () => {
    const records = ['إعدادات الشركة', 'الفواتير', 'مهمة متأخرة', 'دليل الموظفين']
    const found = records.filter(label => searchFolded(label, 'اعدادات'))
    expect(found).toEqual(['إعدادات الشركة'])
  })
})
