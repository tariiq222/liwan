const ARABIC_INDIC_ZERO = 0x0660
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0

/** Latin digits for Arabic-Indic (U+0660-0669) and Extended Arabic-Indic (U+06F0-06F9) ones; every other character is kept. */
export const latinDigits = (value: string): string => value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
  const code = digit.charCodeAt(0)
  return String(code - (code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO))
})
