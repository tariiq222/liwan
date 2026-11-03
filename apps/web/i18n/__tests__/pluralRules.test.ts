import { describe, expect, it } from 'vitest'
import { arabicPluralRule } from '../pluralRules'

// The meetings locale strings carry six Arabic forms (zero | one | two | few | many | other);
// the rule must land every meeting count on the form that reads correctly.
describe('arabic plural rule', () => {
  it('maps the six CLDR categories in the meetings strings order', () => {
    expect(arabicPluralRule(0, 6)).toBe(0) // بلا لقاءات
    expect(arabicPluralRule(1, 6)).toBe(1) // لقاء واحد
    expect(arabicPluralRule(2, 6)).toBe(2) // لقاءان
    expect(arabicPluralRule(3, 6)).toBe(3) // 3 لقاءات
    expect(arabicPluralRule(10, 6)).toBe(3)
    expect(arabicPluralRule(11, 6)).toBe(4) // 11 لقاءً
    expect(arabicPluralRule(99, 6)).toBe(4)
    expect(arabicPluralRule(100, 6)).toBe(5) // 100 لقاء
  })

  it('keeps the vue-i18n default rule for messages with fewer forms', () => {
    expect(arabicPluralRule(0, 2)).toBe(1)
    expect(arabicPluralRule(1, 2)).toBe(0)
    expect(arabicPluralRule(5, 2)).toBe(1)
  })
})
