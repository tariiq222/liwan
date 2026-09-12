import type { AppearanceMode } from './appearance'

export type { AppearanceMode } from './appearance'

export const DEFAULT_PRIMARY = '#18181b'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function normalizeHex(input: string, fallback = DEFAULT_PRIMARY): string {
  const candidate = typeof input === 'string' ? input.trim() : ''
  return HEX_COLOR.test(candidate) ? candidate.toLowerCase() : fallback
}

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function relativeLuminance(hex: string): number {
  const linear = channels(hex).map((value) => {
    const channel = value / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function contrast(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  const light = Math.max(firstLuminance, secondLuminance)
  const dark = Math.min(firstLuminance, secondLuminance)
  return (light + 0.05) / (dark + 0.05)
}

function toHex(values: number[]): string {
  return `#${values.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`
}

function mix(hex: string, target: string, amount: number): string {
  const targetRgb = channels(target)
  return toHex(channels(hex).map((value, index) => value * (1 - amount) + targetRgb[index]! * amount))
}

function foregroundFor(background: string): string {
  return contrast(background, '#000000') >= contrast(background, '#ffffff') ? '#000000' : '#ffffff'
}

export const MODE_SURFACES: Record<AppearanceMode, string[]> = {
  light: ['#f6f7fb', '#ffffff', '#f8f9fc', '#eef1f7', '#f1f3f9', '#e5e8ef', '#d9dde7'],
  cream: ['#f6f3ed', '#fffdf8', '#faf7f1', '#f6f1e7', '#efe8d9', '#e4d9c6', '#e8e0d4', '#d8cbb7'],
  dark: ['#11131a', '#181b24', '#1e222c', '#272c38', '#2d3340', '#394150'],
}

function contrastTone(hex: string, minimumContrast: number, mode: AppearanceMode): string {
  const rgb = channels(hex)
  const surfaces = MODE_SURFACES[mode]
  const target = mode === 'dark' ? 255 : 0
  for (let step = 0; step <= 100; step += 1) {
    const candidate = toHex(rgb.map(value => value + (target - value) * step / 100))
    if (surfaces.every(surface => contrast(candidate, surface) >= minimumContrast)) return candidate
  }
  return mode === 'dark' ? '#ffffff' : '#000000'
}

function chartBase(hex: string, mode: AppearanceMode): string {
  const surfaces = MODE_SURFACES[mode]
  return surfaces.every(surface => contrast(hex, surface) >= 3) ? hex : contrastTone(hex, 3, mode)
}

function hexToHsl(hex: string): { h: number, s: number, l: number } {
  const [r, g, b] = channels(hex).map(value => value / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x]
  return toHex([(r! + m) * 255, (g! + m) * 255, (b! + m) * 255])
}

function rotateHue(hex: string, degrees: number): string {
  const { h, s, l } = hexToHsl(hex)
  return hslToHex((h + degrees + 360) % 360, s, l)
}

// Chart tones stay one family with the brand hue, but spread across
// neighbouring hues and lightness so categories read apart at a glance.
const CHART_HUES = [16, 0, -24, 36, -48, 62] as const
const CHART_TONES: Array<{ target: '#ffffff' | '#000000', amount: number }> = [
  { target: '#ffffff', amount: 0.5 },
  { target: '#ffffff', amount: 0 },
  { target: '#000000', amount: 0.22 },
  { target: '#ffffff', amount: 0.26 },
  { target: '#000000', amount: 0.38 },
  { target: '#ffffff', amount: 0.38 },
]
const INTERACTION = {
  regular: { hover: 0.18, active: 0.32 },
  nearBlack: { hover: 0.24, active: 0.42 },
  nearWhite: { hover: 0.16, active: 0.3 },
} as const

function visualDistance(first: string, second: string): number {
  const firstChannels = channels(first)
  const secondChannels = channels(second)
  return Math.sqrt(firstChannels.reduce((acc, value, index) => acc + (value - secondChannels[index]!) ** 2, 0))
}

function uniqueCharts(colors: string[], mode: AppearanceMode): string[] {
  const next = [...colors]
  const target = mode === 'dark' ? '#ffffff' : '#000000'
  for (let index = 0; index < next.length; index += 1) {
    let step = 0
    while (
      next.slice(0, index).some((existing) => visualDistance(existing, next[index]!) < 13)
      && step < 12
    ) {
      step += 1
      // Move toward the contrast-safe endpoint for the active appearance.
      // Every input has already passed through chartBase, so this preserves
      // the 3:1 chart-surface contrast while separating near-identical tones.
      next[index] = mix(next[index]!, target, 0.1 * step)
    }
  }
  return next
}

function chartFamilyFromPrimary(hex: string, mode: AppearanceMode): string[] {
  const base = chartBase(hex, mode)
  const { s } = hexToHsl(base)
  if (s < 0.12) {
    // Near-neutral brands have weak hue. Start at the minimum-contrast
    // boundary and walk evenly toward the safe endpoint so black and white
    // brands still produce six distinct tones in every appearance.
    const boundary = chartBase(mode === 'dark' ? '#000000' : '#ffffff', mode)
    const endpoint = mode === 'dark' ? '#ffffff' : '#000000'
    return uniqueCharts(
      Array.from({ length: 6 }, (_, index) => mix(boundary, endpoint, index / 5)),
      mode,
    )
  }
  return uniqueCharts(CHART_TONES.map((tone, index) => {
    if (index === 1) return base
    const rotated = rotateHue(base, CHART_HUES[index]!)
    return tone.amount === 0 ? rotated : mix(rotated, tone.target, tone.amount)
  }).map(color => chartBase(color, mode)), mode)
}

function interaction(hex: string) {
  const foreground = foregroundFor(hex)
  const luminance = relativeLuminance(hex)
  const nearBlack = luminance < 0.08
  const nearWhite = luminance > 0.95
  const tone = nearBlack ? INTERACTION.nearBlack : nearWhite ? INTERACTION.nearWhite : INTERACTION.regular
  // For dark bases, lighten states so the pressed states stay visible.
  const target = nearBlack ? '#ffffff' : '#000000'
  const hover = mix(hex, target, tone.hover)
  const active = mix(hex, target, tone.active)
  return { hex, foreground, hover, hoverForeground: foregroundFor(hover), active, activeForeground: foregroundFor(active) }
}

export function createBrandTheme(input: string, mode: AppearanceMode = 'light'): Record<string, string> {
  const primary = interaction(normalizeHex(input))
  const fill = interaction(chartBase(primary.hex, mode))
  const surface = mode === 'dark' ? '#181b24' : mode === 'cream' ? '#fffdf8' : '#ffffff'
  const soft = mix(fill.hex, surface, 0.82)
  const link = contrastTone(primary.hex, 4.5, mode)
  const ring = contrastTone(primary.hex, 3, mode)
  const charts = chartFamilyFromPrimary(primary.hex, mode)
  const shell = mode === 'dark' && relativeLuminance(primary.hex) < 0.05
    ? interaction(mix(primary.hex, '#ffffff', 0.18))
    : primary

  return {
    '--primary': primary.hex,
    '--primary-foreground': primary.foreground,
    '--primary-hover': primary.hover,
    '--primary-hover-foreground': primary.hoverForeground,
    '--primary-active': primary.active,
    '--primary-active-foreground': primary.activeForeground,
    '--primary-fill': fill.hex,
    '--primary-fill-foreground': fill.foreground,
    '--primary-fill-hover': fill.hover,
    '--primary-fill-hover-foreground': fill.hoverForeground,
    '--primary-fill-active': fill.active,
    '--primary-fill-active-foreground': fill.activeForeground,
    '--primary-soft': soft,
    '--primary-soft-foreground': foregroundFor(soft),
    '--brand-link': link,
    '--ring': ring,
    '--chart-1': charts[0]!,
    '--chart-2': charts[1]!,
    '--chart-3': charts[2]!,
    '--chart-4': charts[3]!,
    '--chart-5': charts[4]!,
    '--chart-6': charts[5]!,
    '--sidebar-primary': primary.hex,
    '--sidebar-primary-foreground': primary.foreground,
    '--sidebar-ring': ring,
    '--shell-background': shell.hex,
    '--shell-foreground': shell.foreground,
    '--shell-hover': shell.hover,
    '--shell-active': shell.active,
  }
}
