// LiwanOS's own identity: lavender primary, sand borders, ink titles and brown secondary text on a warm
// cream canvas (owner-approved 2026-10-30). Tenant colours replace the primary only.
// LIWAN_PRIMARY is the default company colour and the text-bearing primary
// (white text 8.29:1); dark mode paints the same role with DARK_PRIMARY_FILL.
export const LIWAN_PRIMARY = '#5b3f8c'

/** Text-bearing primary fill in dark mode (white label 5.02:1) and the lavender accent for icons, rings and text. */
export const DARK_PRIMARY_FILL = '#7c5cc4'
export const DARK_PRIMARY_ACCENT = '#c9bbee'

/** Ink (titles, numbers), brown (secondary text on white, canvas and sand) and sand (borders, table heads). */
export const LIGHT_INK = '#14102a'
export const LIGHT_MUTED_TEXT = '#6b4e2e'
export const LIGHT_SAND = '#eadfc8'
export const LIGHT_ACTIVE_TINT = '#eee8f8'

/** Body text and sand accents on the dark surfaces. */
export const DARK_TEXT = '#ede9f7'
export const DARK_SAND = '#d2c3a3'

/** Page canvas behind the content cards: warm cream, and in dark mode darker than the cards (which stay --ui-bg). */
export const LIGHT_CANVAS = '#f8f4ec'

/** The hairline border of cards, tables and dividers in light mode: sand (dark mode uses DARK_SURFACES.border). */
export const LIGHT_BORDER = LIGHT_SAND

export const DARK_SURFACES = {
  canvas: '#0e0b1f',
  bg: '#14102a',
  muted: '#1b1736',
  elevated: '#231e42',
  accented: '#2e2852',
  border: '#352e5c',
  borderMuted: '#2a2448',
  borderAccented: '#463e72',
} as const

/** Status badge text, kept apart from the indicator colour (dot, ring, soft fill): >= 4.5:1 on its own soft fill. */
export const STATUS_TEXT = {
  light: { success: '#166534', warning: '#92400e', danger: '#991b1b', info: '#075985' },
  dark: { success: '#86efac', warning: '#fcd34d', danger: '#fca5a5', info: '#7dd3fc' },
} as const

export function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first)
  const b = relativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
