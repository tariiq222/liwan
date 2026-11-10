import type { Money } from '@liwan/commercial-contracts'

/** Preserve the invoice's decimal digits without a binary floating-point division. */
export function formatNoticeMoney({ minor, exponent, currency }: Money) {
  if (exponent === 0) return `${minor} ${currency}`
  const digits = String(minor).padStart(exponent + 1, '0')
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)} ${currency}`
}
