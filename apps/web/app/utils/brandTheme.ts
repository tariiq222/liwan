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
  light: ['#ffffff', '#fafafa', '#f4f4f5', '#f5f6f8', '#ebedf0', '#e1e3e7', '#eaebee', '#d1d4d9'],
  cream: ['#fbf7ef', '#f6f1e7', '#efe8d9', '#e4d9c6', '#d8cbb7', '#c2b293'],
  dark: ['#09090b', '#18181b', '#27272a', '#3f3f46', '#34343c', '#52525b'],
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
const DISTINCT_HUE = 25

function hueDelta(first: number, second: number): number {
  const delta = Math.abs(first - second) % 360
  return Math.min(delta, 360 - delta)
}

function lerpHue(from: number, to: number, amount: number): number {
  const delta = ((to - from + 540) % 360) - 180
  return (from + delta * amount + 360) % 360
}

function mixHue(from: string, to: string, amount: number): string {
  const start = hexToHsl(from)
  const end = hexToHsl(to)
  return hslToHex(
    lerpHue(start.h, end.h, amount),
    start.s * (1 - amount) + end.s * amount,
    start.l * (1 - amount) + end.l * amount,
  )
}

function uniqueCharts(colors: string[]): string[] {
  const next = [...colors]
  for (let index = 0; index < next.length; index += 1) {
    let step = 0
    while (next.slice(0, index).includes(next[index]!) && step < 8) {
      step += 1
      next[index] = mix(next[index]!, step % 2 === 0 ? '#000000' : '#ffffff', 0.1 * step)
    }
  }
  return next
}

function chartFamilyFromPrimary(hex: string, mode: AppearanceMode): string[] {
  const base = chartBase(hex, mode)
  const { s } = hexToHsl(base)
  if (s < 0.12) {
    // Near-neutral brands have no hue to rotate; spread lightness toward the opposite pole of the theme.
    const target = mode === 'dark' ? '#000000' : '#ffffff'
    return uniqueCharts([0.6, 0, 0.15, 0.3, 0.45, 0.75].map(amount => mix(base, target, amount)))
  }
  return uniqueCharts(CHART_TONES.map((tone, index) => {
    if (index === 1) return base
    const rotated = rotateHue(base, CHART_HUES[index]!)
    return tone.amount === 0 ? rotated : mix(rotated, tone.target, tone.amount)
  }))
}

function chartFamily(primaryHex: string, accentHex: string, mode: AppearanceMode): string[] {
  const primary = chartBase(primaryHex, mode)
  const accent = chartBase(accentHex, mode)
  const primaryHsl = hexToHsl(primary)
  const accentHsl = hexToHsl(accent)
  if (hueDelta(primaryHsl.h, accentHsl.h) < DISTINCT_HUE || (primaryHsl.s < 0.12 && accentHsl.s < 0.12)) {
    return chartFamilyFromPrimary(primaryHex, mode)
  }
  return uniqueCharts([
    mix(primary, '#ffffff', 0.5),
    primary,
    mixHue(primary, accent, 0.33),
    mixHue(primary, accent, 0.66),
    accent,
    mix(accent, '#000000', 0.22),
  ].map(hex => chartBase(hex, mode)))
}

function interaction(hex: string) {
  const foreground = foregroundFor(hex)
  // Near-black brands need lighter interaction tones so each state remains visible.
  const nearBlack = relativeLuminance(hex) < 0.02
  const hover = mix(hex, nearBlack ? '#ffffff' : '#000000', nearBlack ? 0.08 : 0.1)
  const active = mix(hex, nearBlack ? '#ffffff' : '#000000', nearBlack ? 0.16 : 0.2)
  return { hex, foreground, hover, hoverForeground: foregroundFor(hover), active, activeForeground: foregroundFor(active) }
}

export function derivedSecondary(primary: string, mode: AppearanceMode = 'light'): string {
  const surface = mode === 'dark' ? '#18181b' : mode === 'cream' ? '#f6f1e7' : '#ffffff'
  return mix(normalizeHex(primary), surface, 0.88)
}

export function brandPairContrast(primary: string, secondary: string): number {
  const resolvedPrimary = normalizeHex(primary)
  return contrast(resolvedPrimary, normalizeHex(secondary, derivedSecondary(resolvedPrimary)))
}

export function createBrandTheme(input: string, mode: AppearanceMode = 'light', secondaryInput?: string): Record<string, string> {
  const primary = interaction(normalizeHex(input))
  const secondaryHex = typeof secondaryInput === 'string' && HEX_COLOR.test(secondaryInput.trim())
    ? secondaryInput.trim().toLowerCase()
    : derivedSecondary(primary.hex, mode)
  const secondary = interaction(secondaryHex)
  const fill = interaction(chartBase(primary.hex, mode))
  const accentFill = interaction(chartBase(secondary.hex, mode))
  const surface = mode === 'dark' ? '#18181b' : mode === 'cream' ? '#f6f1e7' : '#ffffff'
  const accentSoft = mix(accentFill.hex, surface, 0.82)
  const link = contrastTone(primary.hex, 4.5, mode)
  const ring = contrastTone(primary.hex, 3, mode)
  const charts = chartFamily(primary.hex, secondary.hex, mode)
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
    '--nasq-brand-secondary': secondary.hex,
    '--nasq-brand-secondary-foreground': secondary.foreground,
    '--nasq-brand-secondary-fill': accentFill.hex,
    '--nasq-brand-secondary-fill-foreground': accentFill.foreground,
    '--nasq-brand-secondary-fill-hover': accentFill.hover,
    '--nasq-brand-secondary-fill-hover-foreground': accentFill.hoverForeground,
    '--nasq-brand-secondary-fill-active': accentFill.active,
    '--nasq-brand-secondary-fill-active-foreground': accentFill.activeForeground,
    '--nasq-brand-secondary-soft': accentSoft,
    '--nasq-brand-secondary-soft-foreground': foregroundFor(accentSoft),
    // Preview only: customer html keeps the neutral --secondary token.
    ...(secondaryInput === undefined ? {} : {
      '--secondary': secondary.hex,
      '--secondary-foreground': secondary.foreground,
      '--secondary-hover': secondary.hover,
      '--secondary-hover-foreground': secondary.hoverForeground,
      '--secondary-active': secondary.active,
      '--secondary-active-foreground': secondary.activeForeground,
    }),
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
