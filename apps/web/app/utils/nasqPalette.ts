// Nasq's own identity (spec 2026-10-11 §3). Tenant colours replace the
// primary only; the midnight rail and lime accent stay Nasq's.
export const NASQ_MIDNIGHT = '#13234a'
export const NASQ_LIME = '#c8f031'
export const NASQ_LIME_FOREGROUND = '#13234a'

/** Page canvas behind the content cards: light slate tint, and in dark mode darker than the cards (which stay --ui-bg). */
export const LIGHT_CANVAS = '#f6f7fb'

export const DARK_SURFACES = {
  canvas: '#070d1c',
  bg: '#0a1124',
  muted: '#0f182f',
  elevated: '#15203b',
  accented: '#1d2a48',
  border: '#22304f',
  borderMuted: '#1a2642',
  borderAccented: '#2c3b5e',
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
