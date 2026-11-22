const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'

/** Latin digits for Arabic-Indic ones; every other character is kept. */
export const latinDigits = (value: string): string => value.replace(/[٠-٩]/g, digit => String(ARABIC_INDIC.indexOf(digit)))
