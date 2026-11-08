// LiwanOS's own identity: black ink on white and cool grey neutrals (charcoal in dark mode), owner-approved for the
// dashboard redesign. The interface primary is the ink; a company colour only paints documents and reports.

/** The default company colour of documents and reports (the server default); it never themes the interface. */
export const DEFAULT_COMPANY_COLOR = '#7843c6'

/** The ink primary: solid buttons, selected states, links and titles in light mode (white label). */
export const INK = '#14102a'
export const INK_HOVER = '#2b2545'
export const INK_ACTIVE = '#3a3550'

/** Dark mode inverts the primary: a light fill under a near-black label. */
export const DARK_PRIMARY_FILL = '#f3f3f6'
export const DARK_PRIMARY_LABEL = '#0a0a0c'

/** Light text roles: ink for titles and numbers, a mid tone, and secondary text. */
export const LIGHT_INK = INK
export const LIGHT_MID_TEXT = '#3a3550'
export const LIGHT_MUTED_TEXT = '#6b6b76'

/** Light surfaces: white page, #fafafa sidebar, #f4f4f5 soft fills and the #e8e8eb hairline. */
export const LIGHT_CANVAS = '#ffffff'
export const LIGHT_SIDEBAR = '#fafafa'
export const LIGHT_SOFT = '#f4f4f5'
export const LIGHT_BORDER = '#e8e8eb'
export const LIGHT_ACTIVE_TINT = '#f4f4f5'

/** Dark text roles on the charcoal surfaces. */
export const DARK_TEXT = '#f3f3f6'
export const DARK_MID_TEXT = '#dcdce3'
export const DARK_MUTED_TEXT = '#a9a9b5'

/** Dark charcoal surfaces: page, sidebar, cards (--ui-bg), soft fills, selected nav and the hairline. */
export const DARK_SURFACES = {
  canvas: '#1d1d22',
  sidebar: '#222228',
  bg: '#27272e',
  muted: '#2f2f37',
  elevated: '#2f2f37',
  accented: '#383842',
  border: '#3a3a44',
  borderMuted: '#32323b',
  borderAccented: '#4a4a56',
} as const
export const DARK_NAV_ACTIVE = '#30303a'

/** Per-application icon tiles (light, dark) and button shades (white label), app-identity.css. */
export const APP_TILES = {
  crm: { light: '#5b8def', dark: '#78a3f5', action: '#2f62c9' },
  inbox: { light: '#2ad67a', dark: '#3ee08a', action: '#15803d' },
  projects: { light: '#4f5bd5', dark: '#7480ee', action: '#3d47b8' },
  hr: { light: '#e0644f', dark: '#ef7d6a', action: '#c2412d' },
  finance: { light: '#1f8a5b', dark: '#34b07a', action: '#166c47' },
  appointments: { light: '#8bb513', dark: '#9fca2a', action: '#557309' },
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
