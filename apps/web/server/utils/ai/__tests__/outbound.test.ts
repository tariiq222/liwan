import { describe, expect, it } from 'vitest'
import { isSaudiId, withholdText, withholdValue } from '../outbound'

// Valid check digits (the Luhn rule on ten digits): a citizen ID and an iqama number.
const CITIZEN_ID = '1000000008'
const IQAMA = '2000000006'

describe('outbound data policy content scan', () => {
  it('recognises a Saudi ID or iqama only when its check digit holds', () => {
    expect(isSaudiId(CITIZEN_ID)).toBe(true)
    expect(isSaudiId(IQAMA)).toBe(true)
    expect(isSaudiId('1000000001')).toBe(false)
  })

  it('withholds identity numbers, keeping ordinary numbers', () => {
    expect(withholdText(`هوية ${CITIZEN_ID} وإقامة ${IQAMA}`)).toBe('هوية [national_id withheld] وإقامة [national_id withheld]')
    expect(withholdText('المبلغ 1000000001 ريال، والطلب 12345')).toBe('المبلغ 1000000001 ريال، والطلب 12345')
    expect(withholdText('الهوية 1 000 000 008 والإقامة 2000-000-006')).toBe('الهوية [national_id withheld] والإقامة [national_id withheld]')
  })

  it('reads Arabic-Indic digits like Latin ones', () => {
    expect(withholdText('رقم الهوية ١٠٠٠٠٠٠٠٠٨')).toBe('رقم الهوية [national_id withheld]')
    expect(withholdText('جوال ٠٥٥١٢٣٤٥٦٧')).toBe('جوال [phone withheld]')
  })

  it('withholds Saudi IBANs, with or without spaces', () => {
    expect(withholdText('SA0380000000608010167519')).toBe('[iban withheld]')
    expect(withholdText('حوّل إلى SA03 8000 0000 6080 1016 7519 اليوم')).toBe('حوّل إلى [iban withheld] اليوم')
    // A value glued to other characters is still withheld; the rest of the run stays.
    expect(withholdText('رقمSA0380000000608010167519123')).toBe('رقم[iban withheld]123')
  })

  it('withholds Saudi mobile numbers in their usual forms', () => {
    for (const phone of ['0551234567', '055 123 4567', '+966551234567', '00966551234567', '966 55 123 4567']) {
      expect(withholdText(`اتصل على ${phone}`)).toBe('اتصل على [phone withheld]')
    }
    for (const phone of ['+9660551234567', '(+966) 55 123 4567', '+966 (0) 55 123 4567', '055.123.4567', '055-123-4567']) {
      expect(withholdText(`اتصل على ${phone}`)).toBe('اتصل على [phone withheld]')
    }
    expect(withholdText('الكمية 551234567')).toBe('الكمية 551234567')
  })

  it('withholds email addresses', () => {
    expect(withholdText('راسل ahmed.ali+hr@example.com.sa')).toBe('راسل [email withheld]')
    expect(withholdText('راسل ahmed@أحمد.السعودية')).toBe('راسل [email withheld]')
  })

  it('scans a long run without a match in linear time', () => {
    const started = performance.now()
    withholdText('a'.repeat(200_000))
    withholdText(`${'a.'.repeat(50_000)}@`)
    // Thousands of matches are replaced in one pass, not one copy of the text per match.
    withholdText(Array.from({ length: 14_000 }, (_, index) => `a${index}@b.sa`).join(' '))
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('keeps names and ordinary text', () => {
    expect(withholdText('مهام أحمد متأخرة منذ 3 أيام')).toBe('مهام أحمد متأخرة منذ 3 أيام')
  })

  it('walks a tool result, leaving keys and non-string values alone', () => {
    const result = { ok: true, data: { items: [{ id: 7, name: 'أحمد', description: `جواله 0551234567 وهويته ${CITIZEN_ID}` }], total: 1 } }
    expect(withholdValue(result)).toEqual({
      ok: true,
      data: { items: [{ id: 7, name: 'أحمد', description: 'جواله [phone withheld] وهويته [national_id withheld]' }], total: 1 },
    })
  })
})
