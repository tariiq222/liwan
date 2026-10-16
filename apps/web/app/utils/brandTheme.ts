import type { AppearanceMode } from './appearance'
import { DARK_SURFACES, WEBVUE_MIDNIGHT, contrastRatio, relativeLuminance } from './webvuePalette'

export const DEFAULT_PRIMARY = WEBVUE_MIDNIGHT

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

// Charts (DESIGN.md §2): a fixed categorical palette that does not follow the tenant colour. Series 1 is the
// tenant primary (readable on the chart surface); series 2-6 are teal, amber, violet, rose and sky. Light mode
// uses the 600 step where the 500 step falls under 3:1 on a white card (amber, sky); dark mode uses the 400 step.
// A tenant primary that lands on one of these hues takes a spare instead, so two series never share a hue.
export const CATEGORICAL_CHART_COLORS = {
  light: ['#0d9488', '#d97706', '#8b5cf6', '#f43f5e', '#0284c7'],
  dark: ['#2dd4bf', '#fbbf24', '#a78bfa', '#fb7185', '#38bdf8'],
} as const satisfies Record<AppearanceMode, readonly string[]>
const SPARE_CHART_COLORS = {
  light: ['#ea580c', '#c026d3'],
  dark: ['#fb923c', '#e879f9'],
} as const satisfies Record<AppearanceMode, readonly string[]>

/** Status series for charts (status mix, health, overdue): the same fixed colours as the status badges, never the tenant primary. */
export const STATUS_CHART_COLORS = {
  light: { success: '#16a34a', info: '#1d4ed8', warning: '#d97706', error: '#dc2626', neutral: '#64748b' },
  dark: { success: '#4ade80', info: '#60a5fa', warning: '#fbbf24', error: '#f87171', neutral: '#94a3b8' },
} as const satisfies Record<AppearanceMode, Record<'success' | 'info' | 'warning' | 'error' | 'neutral', string>>

function visualDistance(first: string, second: string): number {
  const firstChannels = channels(first)
  const secondChannels = channels(second)
  return Math.sqrt(firstChannels.reduce((acc, value, index) => acc + (value - secondChannels[index]!) ** 2, 0))
}

function chartSeries(first: string, mode: AppearanceMode): string[] {
  const spares: string[] = [...SPARE_CHART_COLORS[mode]]
  return [first, ...CATEGORICAL_CHART_COLORS[mode].map(color => (visualDistance(first, color) < 40 ? spares.shift() ?? color : color))]
}

const INTERACTION = {
  regular: { hover: 0.18, active: 0.32 },
  nearBlack: { hover: 0.24, active: 0.42 },
  nearWhite: { hover: 0.16, active: 0.3 },
} as const

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

// The dark-mode link/fill tone: keeps the brand hue (a deep brand colour becomes a light tint of itself,
// not the grey that mixing toward white gives) at the first lightness that reads 4.5:1 on every dark surface.
export function darkLink(input: string): string {
  const hex = normalizeHex(input)
  const surfaces = MODE_SURFACES.dark
  const { h, s, l } = hexToHsl(hex)
  const saturation = s < 0.12 ? s : Math.max(s, 0.5)
  for (let step = Math.round(l * 100); step <= 100; step += 1) {
    const candidate = hslToHex(h, saturation, step / 100)
    if (surfaces.every(surface => contrastRatio(candidate, surface) >= 4.5)) return candidate
  }
  return contrastTone(hex, 4.5, 'dark')
}

export function createBrandTheme(input: string, mode: AppearanceMode = 'light'): Record<string, string> {
  const primary = interaction(normalizeHex(input))
  const link = mode === 'dark' ? darkLink(primary.hex) : contrastTone(primary.hex, 4.5, mode)
  const fill = interaction(mode === 'dark' ? link : chartBase(primary.hex, mode))
  const surface = mode === 'dark' ? DARK_SURFACES.bg : '#ffffff'
  const soft = mix(fill.hex, surface, 0.82)
  const ring = mode === 'dark' ? link : contrastTone(primary.hex, 3, mode)
  const charts = chartSeries(fill.hex, mode)
  const status = STATUS_CHART_COLORS[mode]
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
    '--chart-status-success': status.success,
    '--chart-status-info': status.info,
    '--chart-status-warning': status.warning,
    '--chart-status-error': status.error,
    '--chart-status-neutral': status.neutral,
    '--sidebar-primary': primary.hex,
    '--sidebar-primary-foreground': primary.foreground,
    '--sidebar-ring': ring,
  }
}
