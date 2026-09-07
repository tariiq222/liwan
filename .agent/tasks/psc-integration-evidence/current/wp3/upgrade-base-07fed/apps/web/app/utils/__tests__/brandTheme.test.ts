import { describe, expect, it } from 'vitest'
import { createBrandTheme, DEFAULT_PRIMARY } from '../brandTheme'

function channel(value: number) {
  const normalized = value / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string) {
  const bytes = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16))
  return 0.2126 * channel(bytes[0]!) + 0.7152 * channel(bytes[1]!) + 0.0722 * channel(bytes[2]!)
}

function contrast(first: string, second: string) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}

describe('createBrandTheme', () => {
  it.each([
    ['#000000', '#ffffff'],
    ['#ffffff', '#000000'],
    ['#ffff00', '#000000'],
    [DEFAULT_PRIMARY, '#ffffff'],
  ])('chooses the more readable foreground for %s', (primary, expectedForeground) => {
    const theme = createBrandTheme(primary)

    expect(theme['--primary']).toBe(primary)
    expect(theme['--primary-foreground']).toBe(expectedForeground)
    expect(theme['--sidebar-primary']).toBe(primary)
    expect(theme['--sidebar-primary-foreground']).toBe(expectedForeground)
  })

  it.each(['not-a-colour', '#fff', '#123456;', 'red}body{display:none}', 'url(javascript:alert(1))'])
    ('falls back without reflecting malformed CSS input %s', (input) => {
      const theme = createBrandTheme(input)

      expect(theme['--primary']).toBe(DEFAULT_PRIMARY)
      expect(Object.values(theme)).not.toContain(input)
      expect(Object.values(theme).every(value => /^#[0-9a-f]{6}$/.test(value))).toBe(true)
    })

  it.each(['#ffffff', '#ffff00', '#0055ff', DEFAULT_PRIMARY])
    ('derives accessible link and focus colours for %s', (primary) => {
      const theme = createBrandTheme(primary)

      expect(contrast(theme['--brand-link']!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme['--ring']!, '#ffffff')).toBeGreaterThanOrEqual(3)
      expect(theme['--sidebar-ring']).toBe(theme['--ring'])
    })

  it.each(['#000000', '#ffffff', '#ffff00', '#0055ff', DEFAULT_PRIMARY])('preserves %s in dark mode with readable links and focus rings', (primary) => {
    const theme = createBrandTheme(primary, 'dark')
    expect(theme['--primary']).toBe(primary)
    expect(contrast(primary, theme['--primary-foreground']!)).toBeGreaterThanOrEqual(4.5)
    for (const surface of ['#09090b', '#18181b', '#27272a']) {
      expect(contrast(theme['--brand-link']!, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme['--ring']!, surface)).toBeGreaterThanOrEqual(3)
    }
  })

  it('returns only the documented CSS custom properties', () => {
    expect(Object.keys(createBrandTheme('#0055ff')).sort()).toEqual([
      '--brand-link',
      '--primary',
      '--primary-foreground',
      '--ring',
      '--sidebar-primary',
      '--sidebar-primary-foreground',
      '--sidebar-ring',
    ])
  })
})
