import type { Cadence, Money, Quote } from '@nasq/commercial-contracts'

export function formatCommercialMoney(money: Money, locale = 'ar'): string {
  const intl = locale.startsWith('ar') ? 'ar-SA-u-nu-latn' : 'en-US'
  return new Intl.NumberFormat(intl, { style: 'currency', currency: money.currency, minimumFractionDigits: money.exponent, maximumFractionDigits: money.exponent }).format(money.minor / 10 ** money.exponent)
}

export function cadenceLabel(c: Cadence, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (c.count === 1) return t(`commercial.pricing.cadence.${c.unit}.one`)
  return t(`commercial.pricing.cadence.${c.unit}.many`, { count: c.count })
}

export const quoteLinesByTiming = (quote: Quote, timing: 'now' | 'renewal') => quote.lines.filter(l => l.timing === timing)
