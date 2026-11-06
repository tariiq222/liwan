import { describe, expect, it } from 'vitest'
import { isSaudiId, protectText, protectValue, restoreText, restoreValue, streamRestorer, tokenKeyFrom } from '../outbound'

const KEY = tokenKeyFrom('test-secret-of-at-least-32-characters')
const OTHER_KEY = tokenKeyFrom('another-secret-of-at-least-32-chars')
// What the provider sees, with each token's payload hidden, so the expectations read as text.
const masked = (text: string) => protectText(text, KEY).replace(/\[(phone|email):[A-Za-z0-9_-]+\]/g, '[$1 token]')
const withholdText = masked

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
    expect(withholdText('جوال ٠٥٥١٢٣٤٥٦٧')).toBe('جوال [phone token]')
  })

  it('withholds Saudi IBANs, with or without spaces', () => {
    expect(withholdText('SA0380000000608010167519')).toBe('[iban withheld]')
    expect(withholdText('حوّل إلى SA03 8000 0000 6080 1016 7519 اليوم')).toBe('حوّل إلى [iban withheld] اليوم')
    // A value glued to other characters is still withheld; the rest of the run stays.
    expect(withholdText('رقمSA0380000000608010167519123')).toBe('رقم[iban withheld]123')
  })

  it('withholds Saudi mobile numbers in their usual forms', () => {
    for (const phone of ['0551234567', '055 123 4567', '+966551234567', '00966551234567', '966 55 123 4567']) {
      expect(withholdText(`اتصل على ${phone}`)).toBe('اتصل على [phone token]')
    }
    for (const phone of ['+9660551234567', '(+966) 55 123 4567', '+966 (0) 55 123 4567', '055.123.4567', '055-123-4567']) {
      expect(withholdText(`اتصل على ${phone}`)).toBe('اتصل على [phone token]')
    }
    expect(withholdText('الكمية 551234567')).toBe('الكمية 551234567')
  })

  it('withholds email addresses', () => {
    expect(withholdText('راسل ahmed.ali+hr@example.com.sa')).toBe('راسل [email token]')
    expect(withholdText('راسل ahmed@أحمد.السعودية')).toBe('راسل [email token]')
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
    const sent = protectValue(result, KEY)
    expect(JSON.parse(JSON.stringify(sent).replace(/\[(phone|email):[A-Za-z0-9_-]+\]/g, '[$1 token]'))).toEqual({
      ok: true,
      data: { items: [{ id: 7, name: 'أحمد', description: 'جواله [phone token] وهويته [national_id withheld]' }], total: 1 },
    })
  })

  it('gives one value one token, and restores it to the exact text the user wrote', () => {
    const text = 'اتصل على 055 123 4567 أو راسل ahmed@example.sa'
    const sent = protectText(text, KEY)
    expect(sent).not.toContain('4567')
    expect(sent).not.toContain('ahmed')
    expect(protectText(text, KEY)).toBe(sent)
    expect(restoreText(sent, KEY)).toBe(text)
  })

  it('never restores identity numbers or IBANs: they leave for good', () => {
    const sent = protectText(`هوية ${CITIZEN_ID} وآيبان SA0380000000608010167519`, KEY)
    expect(restoreText(sent, KEY)).toBe('هوية [national_id withheld] وآيبان [iban withheld]')
  })

  it('leaves a token it did not issue, or one the model altered, as it is', () => {
    const token = protectText('0551234567', KEY)
    expect(restoreText(token, OTHER_KEY)).toBe(token)
    // A middle character: the last one of a base64url payload can carry only padding bits.
    const middle = Math.floor(token.length / 2)
    const altered = token.slice(0, middle) + (token[middle] === 'A' ? 'B' : 'A') + token.slice(middle + 1)
    expect(restoreText(altered, KEY)).toBe(altered)
    expect(restoreText('[email:not-a-real-token-at-all]', KEY)).toBe('[email:not-a-real-token-at-all]')
  })

  it('restores the tokens of a value, keys untouched', () => {
    const input = { to: protectText('0551234567', KEY), body: `مرحبًا ${protectText('a@b.sa', KEY)}` }
    expect(restoreValue(input, KEY)).toEqual({ to: '0551234567', body: 'مرحبًا a@b.sa' })
  })

  it('restores a token split across streamed pieces', () => {
    const text = `اتصل على ${protectText('0551234567', KEY)} الآن [ملاحظة]`
    for (const size of [1, 3, 7, 50]) {
      const restorer = streamRestorer(KEY)
      let shown = ''
      for (let index = 0; index < text.length; index += size) shown += restorer.push(text.slice(index, index + size))
      shown += restorer.flush()
      expect(shown).toBe('اتصل على 0551234567 الآن [ملاحظة]')
    }
  })
})
