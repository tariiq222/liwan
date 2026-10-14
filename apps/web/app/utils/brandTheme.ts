import type { AppearanceMode } from './appearance'
import { DARK_SURFACES, NASQ_MIDNIGHT, contrastRatio, relativeLuminance } from './nasqPalette'

export const DEFAULT_PRIMARY = NASQ_MIDNIGHT

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

function toHex(values: number[]): string {
  return `#${values.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`
}

function mix(hex: string, target: string, amount: number): string {
  const targetRgb = channels(target)
  return toHex(channels(hex).map((value, index) => value * (1 - amount) + targetRgb[index]! * amount))
}

function foregroundFor(background: string): string {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff') ? '#000000' : '#ffffff'
}

export const MODE_SURFACES: Record<AppearanceMode, string[]> = {
  light: ['#f6f7fb', '#ffffff', '#f8f9fc', '#eef1f7', '#f1f3f9', '#e5e8ef', '#d9dde7'],
  dark: Object.values(DARK_SURFACES),
}

function contrastTone(hex: string, minimumContrast: number, mode: AppearanceMode): string {
  const rgb = channels(hex)
  const surfaces = MODE_SURFACES[mode]
  const target = mode === 'dark' ? 255 : 0
  for (let step = 0; step <= 100; step += 1) {
    const candidate = toHex(rgb.map(value => value + (target - value) * step / 100))
    if (surfaces.every(surface => contrastRatio(candidate, surface) >= minimumContrast)) return candidate
  }
  return mode === 'dark' ? '#ffffff' : '#000000'
}

function chartBase(hex: string, mode: AppearanceMode): string {
  const surfaces = MODE_SURFACES[mode]
  return surfaces.every(surface => contrastRatio(hex, surface) >= 3) ? hex : contrastTone(hex, 3, mode)
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

// The dark-mode solid primary button (owner amendment 4, CP2). --brand-link mixes the
// primary toward white until it reads as text on every dark surface, which turns a deep
// brand grey (#13234a -> #a1a7b7). The button keeps the hue instead, holds saturation at
// 0.55 or more (near-neutral brands stay neutral), and takes the darkest lightness that
// stands 3:1 off the page surfaces under a 4.5:1 label. A colour that already passes is kept.
const SOLID_PAGE_SURFACES = [DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.elevated]

function solidReadable(candidate: string): boolean {
  return SOLID_PAGE_SURFACES.every(surface => contrastRatio(candidate, surface) >= 3)
    && contrastRatio(candidate, foregroundFor(candidate)) >= 4.5
}

export function darkSolid(input: string): string {
  const hex = normalizeHex(input)
  if (solidReadable(hex)) return hex
  const { h, s, l } = hexToHsl(hex)
  const saturation = s < 0.12 ? s : Math.max(s, 0.55)
  for (let step = Math.round(Math.max(l, 0.3) * 100); step <= 100; step += 1) {
    const candidate = hslToHex(h, saturation, step / 100)
    if (solidReadable(candidate)) return candidate
  }
  return '#ffffff'
}

export function createBrandTheme(input: string, mode: AppearanceMode = 'light'): Record<string, string> {
  const primary = interaction(normalizeHex(input))
  const fill = interaction(chartBase(primary.hex, mode))
  const surface = mode === 'dark' ? DARK_SURFACES.bg : '#ffffff'
  const soft = mix(fill.hex, surface, 0.82)
  const link = contrastTone(primary.hex, 4.5, mode)
  const ring = contrastTone(primary.hex, 3, mode)
  const charts = chartFamilyFromPrimary(primary.hex, mode)
  // Read only by the dark solid button recipe (app.config.ts); light keeps the stock button.
  const solid = interaction(mode === 'dark' ? darkSolid(primary.hex) : link)

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
    '--primary-solid': solid.hex,
    '--primary-solid-foreground': solid.foreground,
    '--primary-solid-hover': solid.hover,
    '--primary-solid-hover-foreground': solid.hoverForeground,
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
  }
}
