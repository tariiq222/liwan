/** An amount in a currency code (`SAR`) in the given locale; an unknown code falls back to "amount code". */
export function formatCurrency(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}
