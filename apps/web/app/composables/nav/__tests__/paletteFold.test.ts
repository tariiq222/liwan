import { describe, expect, it } from 'vitest'
import { paletteIndexText, paletteSearchTerm } from '../paletteSearch'

// The palette indexes folded text and searches a folded term. Folding one side only is the defect this holds against:
// the stored «مهمة» became «مهمه» while the typed «مهمة» stayed as it was, so the two no longer matched.
describe('palette fold', () => {
  it('folds every indexed field, so the stored spelling is the loose one', () => {
    expect(paletteIndexText({ label: 'إعدادات الشركة' }, 'label')).toBe('اعدادات الشركه')
    expect(paletteIndexText({ label: 'مهمة متأخرة' }, ['label'])).toBe('مهمه متاخره')
  })

  it('indexes a non-string field as empty instead of the string "undefined"', () => {
    expect(paletteIndexText({ description: null }, 'description')).toBe('')
    expect(paletteIndexText({}, 'description')).toBe('')
  })

  it('folds the typed term exactly like the index it is matched against', () => {
    expect(paletteSearchTerm('اعدادات')).toBe(paletteIndexText({ label: 'إعدادات' }, 'label'))
    expect(paletteSearchTerm('مهمه')).toBe(paletteIndexText({ label: 'مهمة' }, 'label'))
    // A term Fuse would otherwise miss: the correct spelling, unchanged by the user.
    expect(paletteSearchTerm('مهمة')).toBe(paletteIndexText({ label: 'مهمة' }, 'label'))
  })
})
