/**
 * The outbound data policy's content scan (spec 2026-11-04 §6.12, layer 2). Before a user message, a tool result or a
 * submitted draft leaves this server for the AI service, every value with a fixed shape that the policy covers is replaced:
 * identity and iqama numbers and IBANs by a marker naming their kind (they never come back), mobile numbers and emails by a
 * token that carries the value encrypted under a key only this server holds. On the way back (the streamed answer, a tool
 * call's input, a run's history) every token this server issued is replaced by its value again, so the user and the tools see
 * the real number while the provider and the AI service never do. Layer 1 (the tool registry in Odoo) already refuses tools
 * that expose blocked fields; this scan catches the same values inside free text, whatever the provider or key.
 *
 * `odoo-addons/liwan_ai/models/outbound_scan.py` ports the same patterns for the knowledge text Odoo indexes; it has no
 * token key, so there every kind is withheld with its marker. Keep the patterns of the two in step.
 */
import { createCipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

export type ScannedKind = 'national_id' | 'iban' | 'phone' | 'email'
type TokenKind = Extract<ScannedKind, 'phone' | 'email'>

const MARKERS: Record<Exclude<ScannedKind, TokenKind>, string> = {
  national_id: '[national_id withheld]',
  iban: '[iban withheld]',
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

type Span = { start: number; end: number; kind: ScannedKind }

/** Every covered value of `text`, ascending and non-overlapping. */
function findSpans(text: string): Span[] {
  let scanned = latinDigits(text)
  const spans: Span[] = []
  for (const [kind, pattern] of PATTERNS) {
    if (kind === 'email' && !scanned.includes('@')) continue
    const found: Span[] = []
    for (const match of scanned.matchAll(pattern)) {
      if (kind === 'national_id' && !isSaudiId(match[0].replace(/\D/g, ''))) continue
      found.push({ start: match.index, end: match.index + match[0].length, kind })
    }
    if (found.length === 0) continue
    // A taken span is masked with a filler of the same length (no digit, letter or @), so indices stay aligned and no
    // later pattern matches inside it. Built in one pass, whatever the number of spans.
    const parts: string[] = []
    let cursor = 0
    for (const span of found) {
      parts.push(scanned.slice(cursor, span.start), '\u0000'.repeat(span.end - span.start))
      cursor = span.end
    }
    parts.push(scanned.slice(cursor))
    scanned = parts.join('')
    spans.push(...found)
  }
  return spans.sort((left, right) => left.start - right.start)
}

// --- Tokens -------------------------------------------------------------------------------------------------------------

const TOKEN = /\[(phone|email):([A-Za-z0-9_-]{16,400})\]/g
const SIV_BYTES = 12

/** The two keys a token needs, derived from the server's secret: one encrypts, one authenticates and fixes the IV. */
export type TokenKey = { encryption: Buffer; authentication: Buffer }

export function tokenKeyFrom(secret: string): TokenKey {
  const root = createHash('sha256').update(secret).digest()
  return {
    encryption: createHmac('sha256', root).update('liwan-ai-token-encryption').digest(),
    authentication: createHmac('sha256', root).update('liwan-ai-token-authentication').digest(),
  }
}

let processKey: TokenKey | null = null

/**
 * The token key of this deployment, from `NUXT_AI_TOKEN_KEY`. Without one (development), a random key lives as long as this
 * process: tokens then restore until the server restarts, and a warning says so once.
 */
export function aiTokenKey(event: H3Event): TokenKey {
  const secret = useRuntimeConfig(event).aiTokenKey
  if (secret) return tokenKeyFrom(secret)
  if (!processKey) {
    console.warn('NUXT_AI_TOKEN_KEY is not set: AI tokens restore only until this server restarts')
    processKey = tokenKeyFrom(randomBytes(32).toString('hex'))
  }
  return processKey
}

/** The synthetic IV of a value: a keyed hash of its kind and value, so one value always gets the same token. */
function syntheticIv(key: TokenKey, kind: TokenKind, value: string): Buffer {
  return createHmac('sha256', key.authentication).update(`${kind}\u0000${value}`).digest().subarray(0, SIV_BYTES)
}

function counterIv(siv: Buffer): Buffer {
  return Buffer.concat([siv, Buffer.alloc(16 - SIV_BYTES)])
}

/** `[kind:payload]`: the value encrypted with AES-256-CTR under its synthetic IV, which also authenticates it. */
function tokenFor(key: TokenKey, kind: TokenKind, value: string): string {
  const siv = syntheticIv(key, kind, value)
  const cipher = createCipheriv('aes-256-ctr', key.encryption, counterIv(siv))
  const sealed = Buffer.concat([siv, cipher.update(value, 'utf8'), cipher.final()])
  return `[${kind}:${sealed.toString('base64url')}]`
}

/** The value of a token this server issued, or null for anything else (a token the model altered, or another key's). */
function valueOf(key: TokenKey, kind: TokenKind, payload: string): string | null {
  const sealed = Buffer.from(payload, 'base64url')
  if (sealed.length <= SIV_BYTES) return null
  const siv = sealed.subarray(0, SIV_BYTES)
  const decipher = createCipheriv('aes-256-ctr', key.encryption, counterIv(siv))
  const value = Buffer.concat([decipher.update(sealed.subarray(SIV_BYTES)), decipher.final()]).toString('utf8')
  return timingSafeEqual(siv, syntheticIv(key, kind, value)) ? value : null
}

// --- Outbound and back --------------------------------------------------------------------------------------------------

/** One text as it may leave: identity numbers and IBANs withheld for good, mobile numbers and emails as tokens. */
export function protectText(text: string, key: TokenKey): string {
  const spans = findSpans(text)
  if (spans.length === 0) return text
  const parts: string[] = []
  let cursor = 0
  for (const { start, end, kind } of spans) {
    const replacement = kind === 'phone' || kind === 'email' ? tokenFor(key, kind, text.slice(start, end)) : MARKERS[kind]
    parts.push(text.slice(cursor, start), replacement)
    cursor = end
  }
  parts.push(text.slice(cursor))
  return parts.join('')
}

/** One text with every token this server issued replaced by its value. */
export function restoreText(text: string, key: TokenKey): string {
  if (!text.includes('[')) return text
  return text.replace(TOKEN, (token, kind: TokenKind, payload: string) => valueOf(key, kind, payload) ?? token)
}

/** `transform` applied to every string of a JSON value (object keys excepted: they are field names, never data). */
function mapStrings<T>(value: T, transform: (text: string) => string): T {
  if (typeof value === 'string') return transform(value) as T
  if (Array.isArray(value)) return value.map(item => mapStrings(item, transform)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, transform)])) as T
  }
  return value
}

export const protectValue = <T>(value: T, key: TokenKey): T => mapStrings(value, text => protectText(text, key))
export const restoreValue = <T>(value: T, key: TokenKey): T => mapStrings(value, text => restoreText(text, key))

// A streamed answer arrives in pieces, so a token can be split across two of them. At most this many characters after an
// open `[` are held back while they could still be the start of a token.
const HELD_MAX = 420
const TOKEN_PREFIX = /^\[(?:p(?:h(?:o(?:n(?:e(?::[A-Za-z0-9_-]*)?)?)?)?)?|e(?:m(?:a(?:i(?:l(?::[A-Za-z0-9_-]*)?)?)?)?)?)?$/

/** Restores the tokens of a streamed text: `push` returns what may be shown now, `flush` the rest at the end. */
export function streamRestorer(key: TokenKey) {
  let held = ''
  return {
    push(piece: string): string {
      const text = held + piece
      const open = text.lastIndexOf('[')
      const tail = open === -1 ? '' : text.slice(open)
      held = tail && tail.length <= HELD_MAX && TOKEN_PREFIX.test(tail) ? tail : ''
      return restoreText(text.slice(0, text.length - held.length), key)
    },
    flush(): string {
      const rest = held
      held = ''
      return restoreText(rest, key)
    },
  }
}
