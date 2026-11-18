/**
 * The values with a fixed shape that a text must not carry out of the product: Saudi national ID and iqama numbers, IBANs,
 * mobile numbers and emails. The AI outbound policy (`server/utils/ai/outbound.ts`) and the error reports (`errorReportScrub.ts`)
 * share this scan, and the browser imports it too, so it is pure: no Node or Nitro API.
 *
 * `odoo-addons/liwan_platform/outbound_scan.py` ports the same patterns for the knowledge text Odoo indexes. Keep the patterns of
 * the two in step.
 */
export type ScannedKind = 'national_id' | 'iban' | 'phone' | 'email'

/** What stands where a value was withheld for good. */
export const WITHHELD: Record<ScannedKind, string> = {
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

// Order matters: an IBAN contains digit runs and an email may contain one, so the longer shapes are taken first; a span
// once taken is masked, so a later pattern never matches inside it. A pattern errs towards withholding: a few extra
// characters withheld are better than a value sent.
const PATTERNS: [ScannedKind, RegExp][] = [
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

export type Span = { start: number; end: number }
export type ScannedSpan = Span & { kind: ScannedKind }

/** `text` with each span replaced by a filler of the same length (no digit, letter or @), built in one pass. */
function masked(text: string, spans: Span[]): string {
  const parts: string[] = []
  let cursor = 0
  for (const span of spans) {
    parts.push(text.slice(cursor, span.start), '\u0000'.repeat(span.end - span.start))
    cursor = span.end
  }
  parts.push(text.slice(cursor))
  return parts.join('')
}

/** Every covered value of `text`, ascending and non-overlapping. Text inside a `skip` span (ascending) is left unscanned. */
export function findSensitiveSpans(text: string, skip: Span[] = []): ScannedSpan[] {
  let scanned = masked(latinDigits(text), skip)
  const spans: ScannedSpan[] = []
  for (const [kind, pattern] of PATTERNS) {
    if (kind === 'email' && !scanned.includes('@')) continue
    const found: ScannedSpan[] = []
    for (const match of scanned.matchAll(pattern)) {
      if (kind === 'national_id' && !isSaudiId(match[0].replace(/\D/g, ''))) continue
      found.push({ start: match.index, end: match.index + match[0].length, kind })
    }
    if (found.length === 0) continue
    // A taken span is masked, so indices stay aligned and no later pattern matches inside it.
    scanned = masked(scanned, found)
    spans.push(...found)
  }
  return spans.sort((left, right) => left.start - right.start)
}

/** `text` with every covered value replaced by the marker of its kind. */
export function withholdSensitive(text: string): string {
  const spans = findSensitiveSpans(text)
  if (spans.length === 0) return text
  const parts: string[] = []
  let cursor = 0
  for (const { start, end, kind } of spans) {
    parts.push(text.slice(cursor, start), WITHHELD[kind])
    cursor = end
  }
  parts.push(text.slice(cursor))
  return parts.join('')
}

/** `transform` applied to every string of a JSON value (object keys excepted: they are field names, never data). */
export function mapStrings<T>(value: T, transform: (text: string) => string): T {
  if (typeof value === 'string') return transform(value) as T
  if (Array.isArray(value)) return value.map(item => mapStrings(item, transform)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, transform)])) as T
  }
  return value
}
