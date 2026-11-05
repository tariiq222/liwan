/**
 * The outbound data policy's content scan (spec 2026-11-04 §6.12, layer 2): before a user message or a tool result leaves
 * this server for the AI service, every value with a fixed shape that the policy withholds is replaced by a marker naming
 * its kind. Layer 1 (the tool registry in Odoo) already refuses tools that expose blocked fields; this scan catches the
 * same values inside free text, whatever the provider or key.
 */

export type WithheldKind = 'national_id' | 'iban' | 'phone' | 'email'

const MARKERS: Record<WithheldKind, string> = {
  national_id: '[national_id withheld]',
  iban: '[iban withheld]',
  phone: '[phone withheld]',
  email: '[email withheld]',
}

// Arabic-Indic and Extended Arabic-Indic digits are matched as their Latin digits: one character each, so indices stay put.
const ARABIC_DIGITS = /[٠-٩۰-۹]/g
const latinDigits = (text: string) => text.replace(ARABIC_DIGITS, digit => String((digit.charCodeAt(0) & 0xF)))

// A separator inside a written number: a space (no-break included), a dot or a hyphen.
const SEP = '[\\s.\\-]?'

// Order matters: an IBAN contains digit runs and an email may contain one, so the longer shapes are withheld first. A
// pattern errs towards withholding: a few extra characters withheld are better than a value sent.
const PATTERNS: [WithheldKind, RegExp][] = [
  // Every part is bounded (RFC 5321 sizes), so a long run without a match costs linear time, not quadratic.
  ['email', /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,8}\.\p{L}{2,24}/gu],
  ['iban', new RegExp(`SA${SEP}\\d${SEP}\\d(?:${SEP}[0-9A-Z]){20}`, 'gi')],
  ['phone', new RegExp(`(?<![\\d+])(?:\\(?(?:\\+|00)?966\\)?${SEP}(?:\\(?0\\)?${SEP})?|0)5${SEP}\\d(?:${SEP}\\d){7}(?!\\d)`, 'g')],
  ['national_id', new RegExp(`(?<!\\d)[12](?:${SEP}\\d){9}(?!\\d)`, 'g')],
]

/** The check digit of a Saudi national ID or iqama number (the Luhn rule on ten digits): it keeps ordinary numbers through. */
export function isSaudiId(digits: string): boolean {
  let sum = 0
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index])
    const doubled = index % 2 === 0 ? digit * 2 : digit
    sum += doubled > 9 ? doubled - 9 : doubled
  }
  return sum % 10 === 0
}

/** `text` with each span (ascending, non-overlapping) replaced by `marker`, built in one pass whatever the number of spans. */
function replaceSpans(text: string, spans: [number, number][], marker: string): string {
  const parts: string[] = []
  let cursor = 0
  for (const [start, end] of spans) {
    parts.push(text.slice(cursor, start), marker)
    cursor = end
  }
  parts.push(text.slice(cursor))
  return parts.join('')
}

/** One text with every withheld value replaced by its marker. */
export function withholdText(text: string): string {
  let scanned = latinDigits(text)
  let output = text
  for (const [kind, pattern] of PATTERNS) {
    if (kind === 'email' && !scanned.includes('@')) continue
    const spans: [number, number][] = []
    for (const match of scanned.matchAll(pattern)) {
      if (kind === 'national_id' && !isSaudiId(match[0].replace(/\D/g, ''))) continue
      spans.push([match.index, match.index + match[0].length])
    }
    if (spans.length === 0) continue
    // Both strings change together (same spans, same marker), so their indices stay aligned for the next pattern.
    output = replaceSpans(output, spans, MARKERS[kind])
    scanned = replaceSpans(scanned, spans, MARKERS[kind])
  }
  return output
}

/** A JSON value with every string (object keys excepted: they are field names, never data) passed through `withholdText`. */
export function withholdValue<T>(value: T): T {
  if (typeof value === 'string') return withholdText(value) as T
  if (Array.isArray(value)) return value.map(item => withholdValue(item)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withholdValue(item)])) as T
  }
  return value
}
