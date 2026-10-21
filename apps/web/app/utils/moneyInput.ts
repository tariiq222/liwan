// Parsing of typed money amounts: Arabic-Indic and Persian digits, the Arabic decimal and thousands marks,
// exact minor-unit arithmetic (never a float string). Shared by the finance and payroll forms.
export const MAX_MONEY_AMOUNT = 1e12

export type MoneyParse =
  | { ok: true; value: number; minor: bigint; canonical: string }
  | { ok: false; code: 'empty' | 'invalid' | 'negative' | 'precision' | 'too_large' }

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

function mapDigit(char: string): string {
  const arabic = ARABIC_DIGITS.indexOf(char)
  if (arabic >= 0) return String(arabic)
  const persian = PERSIAN_DIGITS.indexOf(char)
  if (persian >= 0) return String(persian)
  return char
}

const ARABIC_DECIMAL = '\u066b'
const ARABIC_THOUSANDS = '\u066c'
const THOUSANDS_SPACE = /[ \u00a0\u202f]/

function parseGroupedInteger(raw: string): string | null {
  if (!raw) return null
  if (/^\d+$/.test(raw)) return raw
  const seps = new Set([...raw].filter(char => !/\d/.test(char)))
  if (seps.size !== 1) return null
  const sep = [...seps][0]!
  if (sep !== ',' && sep !== ARABIC_THOUSANDS && !THOUSANDS_SPACE.test(sep)) return null
  const parts = raw.split(sep)
  if (parts[0]!.length < 1 || parts[0]!.length > 3) return null
  if (parts.some(part => part === '' || !/^\d+$/.test(part))) return null
  if (parts.slice(1).some(part => part.length !== 3)) return null
  if (parts.length < 2) return null
  return parts.join('')
}

function parseCommaAmount(raw: string, decimalPlaces: number): { integer: string; fraction: string } | null {
  const parts = raw.split(',')
  if (parts.length < 2 || parts.some(part => part === '' || !/^\d+$/.test(part))) return null
  const last = parts[parts.length - 1]!
  const head = parts.slice(0, -1)
  if (last.length === 3 && last.length <= decimalPlaces) return null
  if (last.length === 3) {
    const integer = parseGroupedInteger(raw)
    return integer ? { integer, fraction: '' } : null
  }
  if (last.length < 1 || last.length > decimalPlaces) return null
  const integer = head.length === 1 ? (head[0] && /^\d+$/.test(head[0]) ? head[0] : null) : parseGroupedInteger(head.join(','))
  return integer ? { integer, fraction: last } : null
}

function splitAmountParts(mapped: string, decimalPlaces: number): { integer: string; fraction: string } | null {
  const hasDot = mapped.includes('.')
  const hasArabDecimal = mapped.includes(ARABIC_DECIMAL)
  const hasComma = mapped.includes(',')
  const hasArabThousands = mapped.includes(ARABIC_THOUSANDS)
  const hasSpace = THOUSANDS_SPACE.test(mapped)
  if ((mapped.match(/\./g) ?? []).length > 1 || (mapped.match(new RegExp(ARABIC_DECIMAL, 'g')) ?? []).length > 1) return null
  if (hasDot && hasArabDecimal) return null
  if (hasArabDecimal && hasComma) return null
  if (hasDot && hasComma && mapped.lastIndexOf(',') > mapped.indexOf('.')) return null

  if (hasDot || hasArabDecimal) {
    const mark = hasDot ? '.' : ARABIC_DECIMAL
    const [integerRaw, fractionRaw, extra] = mapped.split(mark)
    if (extra !== undefined || integerRaw === undefined || fractionRaw === undefined) return null
    if (fractionRaw === '' || /[^\d]/.test(fractionRaw)) return null
    const integer = parseGroupedInteger(integerRaw)
    return integer ? { integer, fraction: fractionRaw } : null
  }
  if (hasComma) return parseCommaAmount(mapped, decimalPlaces)
  if (hasArabThousands || hasSpace) {
    const integer = parseGroupedInteger(mapped)
    return integer ? { integer, fraction: '' } : null
  }
  if (!/^\d+$/.test(mapped)) return null
  return { integer: mapped, fraction: '' }
}

export function canonicalFromMinor(minor: bigint, decimalPlaces: number): string {
  const negative = minor < 0n
  const abs = negative ? -minor : minor
  if (decimalPlaces <= 0) return `${negative ? '-' : ''}${abs.toString()}`
  const factor = 10n ** BigInt(decimalPlaces)
  const whole = abs / factor
  const frac = (abs % factor).toString().padStart(decimalPlaces, '0')
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`
}

export function parseMoneyInput(raw: string, decimalPlaces: number): MoneyParse {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, code: 'empty' }
  const mapped = Array.from(trimmed, mapDigit).join('')
  if (mapped.startsWith('-') || mapped.includes('-')) return { ok: false, code: 'negative' }
  if (/[eE+]/.test(mapped) || /^(nan|infinity|true|false)$/i.test(mapped)) return { ok: false, code: 'invalid' }
  if (!/^[0-9.,\u066b\u066c \u00a0\u202f]+$/.test(mapped)) return { ok: false, code: 'invalid' }
  const parts = splitAmountParts(mapped, decimalPlaces)
  if (!parts) return { ok: false, code: 'invalid' }
  if (parts.fraction.length > decimalPlaces) return { ok: false, code: 'precision' }
  const whole = parts.integer || '0'
  const fraction = parts.fraction.padEnd(Math.max(decimalPlaces, 0), '0')
  const minor = BigInt(whole) * (10n ** BigInt(Math.max(decimalPlaces, 0))) + BigInt(fraction || '0')
  const maxMinor = BigInt(MAX_MONEY_AMOUNT) * (10n ** BigInt(Math.max(decimalPlaces, 0)))
  if (minor > maxMinor) return { ok: false, code: 'too_large' }
  const canonical = canonicalFromMinor(minor, decimalPlaces)
  return { ok: true, value: Number(canonical), minor, canonical }
}
