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

function darkenUntil(hex: string, minimumContrast: number): string {
  const rgb = channels(hex)
  for (let step = 0; step <= 100; step += 1) {
    const factor = 1 - step / 100
    const candidate = toHex(rgb.map(value => value * factor))
    if (contrast(candidate, '#ffffff') >= minimumContrast) return candidate
  }
  return '#000000'
}

export function createBrandTheme(input: string): Record<string, string> {
  const primary = normalizeHex(input)
  const foreground = contrast(primary, '#000000') >= contrast(primary, '#ffffff')
    ? '#000000'
    : '#ffffff'
  const link = darkenUntil(primary, 4.5)
  const ring = darkenUntil(primary, 3)

  return {
    '--primary': primary,
    '--primary-foreground': foreground,
    '--brand-link': link,
    '--ring': ring,
    '--sidebar-primary': primary,
    '--sidebar-primary-foreground': foreground,
    '--sidebar-ring': ring,
  }
}
