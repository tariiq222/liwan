import type { AppearanceMode } from './appearance'

export const DEFAULT_PRIMARY = '#18181b'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function normalizeHex(input: string): string {
  const candidate = input.trim()
  return HEX_COLOR.test(candidate) ? candidate.toLowerCase() : DEFAULT_PRIMARY
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

function contrastTone(hex: string, minimumContrast: number, mode: AppearanceMode): string {
  const rgb = channels(hex)
  const surfaces = mode === 'dark'
    ? ['#09090b', '#18181b', '#27272a']
    : mode === 'cream'
      ? ['#fbf7ef', '#f6f1e7', '#efe8d9']
      : ['#ffffff', '#fafafa', '#f4f4f5']
  const target = mode === 'dark' ? 255 : 0
  for (let step = 0; step <= 100; step += 1) {
    const candidate = toHex(rgb.map(value => value + (target - value) * step / 100))
    if (surfaces.every(surface => contrast(candidate, surface) >= minimumContrast)) return candidate
  }
  return mode === 'dark' ? '#ffffff' : '#000000'
}

function chartBase(hex: string, mode: AppearanceMode): string {
  const surfaces = mode === 'dark' ? ['#09090b', '#18181b', '#27272a'] : mode === 'cream' ? ['#fbf7ef', '#f6f1e7', '#efe8d9'] : ['#ffffff', '#fafafa', '#f4f4f5']
  return surfaces.every(surface => contrast(hex, surface) >= 3) ? hex : contrastTone(hex, 3, mode)
}

function chartFamily(hex: string, mode: AppearanceMode): string[] {
  const base = chartBase(hex, mode)
  if (relativeLuminance(base) < 0.12) {
    return [0.6, 0, 0.15, 0.3, 0.45, 0.75].map(amount => mix(base, '#ffffff', amount))
  }
  return [
    mix(base, '#ffffff', 0.55),
    base,
    mix(base, '#000000', 0.15),
    mix(base, '#000000', 0.3),
    mix(base, '#000000', 0.45),
    mix(base, '#ffffff', 0.25),
  ]
}

export function createBrandTheme(input: string, mode: AppearanceMode = 'light'): Record<string, string> {
  const primary = normalizeHex(input)
  const foreground = foregroundFor(primary)
  // Near-black brands need lighter interaction tones so each state remains visible.
  const nearBlack = relativeLuminance(primary) < 0.02
  const hover = mix(primary, nearBlack ? '#ffffff' : '#000000', nearBlack ? 0.08 : 0.1)
  const active = mix(primary, nearBlack ? '#ffffff' : '#000000', nearBlack ? 0.16 : 0.2)
  const link = contrastTone(primary, 4.5, mode)
  const ring = contrastTone(primary, 3, mode)
  const charts = chartFamily(primary, mode)

  return {
    '--primary': primary,
    '--primary-foreground': foreground,
    '--primary-hover': hover,
    '--primary-hover-foreground': foregroundFor(hover),
    '--primary-active': active,
    '--primary-active-foreground': foregroundFor(active),
    '--brand-link': link,
    '--ring': ring,
    '--chart-1': charts[0]!,
    '--chart-2': charts[1]!,
    '--chart-3': charts[2]!,
    '--chart-4': charts[3]!,
    '--chart-5': charts[4]!,
    '--chart-6': charts[5]!,
    '--sidebar-primary': primary,
    '--sidebar-primary-foreground': foreground,
    '--sidebar-ring': ring,
    '--shell-background': primary,
    '--shell-foreground': foreground,
    '--shell-hover': hover,
    '--shell-active': active,
  }
}
