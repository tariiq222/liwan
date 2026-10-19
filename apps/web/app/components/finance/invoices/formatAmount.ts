const AMOUNT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A money amount with Latin digits and two decimals; the currency code is drawn after it by the caller. */
export function formatAmount(value: number): string {
  return AMOUNT.format(Number.isFinite(value) ? value : 0)
}
