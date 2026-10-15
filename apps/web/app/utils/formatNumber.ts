// Percent through Intl, with Latin digits and no space or bidi marks before the sign ("16.7%").
const BIDI = /[\u200e\u200f\u061c]/g

/** `value` is in percent points: 16.7 renders "16.7%". */
export function formatPercent(value: number | null | undefined, maximumFractionDigits = 1): string {
  if (value == null || !Number.isFinite(value)) return ''
  return new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits })
    .format(value / 100)
    .replace(BIDI, '')
}
