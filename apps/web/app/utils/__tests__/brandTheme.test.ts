import { describe, expect, it } from 'vitest'
import { createBrandTheme, DEFAULT_PRIMARY, derivedSecondary, brandPairContrast, MODE_SURFACES } from '../brandTheme'

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

  it.each(['#000000', '#010101', '#ffffff', DEFAULT_PRIMARY])('keeps resting, hover and pressed tones distinct for %s', (primary) => {
    const theme = createBrandTheme(primary)

    expect(new Set([theme['--primary'], theme['--primary-hover'], theme['--primary-active']]).size).toBe(3)
    for (const state of ['primary', 'primary-hover', 'primary-active']) {
      expect(contrast(theme[`--${state}`]!, theme[`--${state}-foreground`]!), `${primary}: ${state}`).toBeGreaterThanOrEqual(4.5)
    }
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

  it.each(['#000000', '#ffffff', '#ffff00', '#0055ff', DEFAULT_PRIMARY])('preserves %s in cream mode with readable links and focus rings', (primary) => {
    const theme = createBrandTheme(primary, 'cream')
    expect(theme['--primary']).toBe(primary)
    expect(contrast(primary, theme['--primary-foreground']!)).toBeGreaterThanOrEqual(4.5)
    for (const surface of ['#fbf7ef', '#f6f1e7', '#efe8d9']) {
      expect(contrast(theme['--brand-link']!, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme['--ring']!, surface)).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(['#000000', '#ffffff', '#ffff00', '#0055ff', DEFAULT_PRIMARY])('preserves %s in dark mode with readable links and focus rings', (primary) => {
    const theme = createBrandTheme(primary, 'dark')
    expect(theme['--primary']).toBe(primary)
    expect(contrast(primary, theme['--primary-foreground']!)).toBeGreaterThanOrEqual(4.5)
    expect(theme['--sidebar-primary']).toBe(primary)
    expect(theme['--sidebar-ring']).toBe(theme['--ring'])
    for (const surface of ['#09090b', '#18181b', '#27272a']) {
      expect(contrast(theme['--brand-link']!, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme['--ring']!, surface)).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(['#000000', '#18181b', '#ffffff', '#ffff00', '#0055ff'])('keeps primary fill readable on %s surfaces', (primary) => {
    for (const mode of ['light', 'cream', 'dark'] as const) {
      const surfaces = MODE_SURFACES[mode]
      const theme = createBrandTheme(primary, mode)
      expect(contrast(theme['--primary-fill']!, theme['--primary-fill-foreground']!)).toBeGreaterThanOrEqual(4.5)
      for (const surface of surfaces) {
        expect(contrast(theme['--primary-fill']!, surface), `${primary} ${mode} ${surface}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it.each(['#000000', '#ffffff', '#808080', '#ffff00', DEFAULT_PRIMARY])('keeps fill hover and pressed tones distinct and readable for %s', (primary) => {
    for (const mode of ['light', 'cream', 'dark'] as const) {
      const theme = createBrandTheme(primary, mode)
      expect(new Set([theme['--primary-fill'], theme['--primary-fill-hover'], theme['--primary-fill-active']]).size).toBe(3)
      for (const state of ['primary-fill', 'primary-fill-hover', 'primary-fill-active']) {
        expect(contrast(theme[`--${state}`]!, theme[`--${state}-foreground`]!), `${primary} ${mode} ${state}`).toBeGreaterThanOrEqual(4.5)
      }
      for (const surface of MODE_SURFACES[mode]) {
        expect(contrast(theme['--primary-fill']!, surface), `${primary} ${mode} ${surface}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('lifts a near-black shell in dark mode without changing the stored primary', () => {
    const theme = createBrandTheme(DEFAULT_PRIMARY, 'dark')
    expect(theme['--primary']).toBe(DEFAULT_PRIMARY)
    expect(theme['--shell-background']).not.toBe(DEFAULT_PRIMARY)
    expect(contrast(theme['--shell-background']!, theme['--shell-foreground']!)).toBeGreaterThanOrEqual(4.5)
  })

  it('derives chart tones from the configured primary color', () => {
    const first = createBrandTheme('#0055ff')
    const second = createBrandTheme('#d14a00')
    const firstCharts = Array.from({ length: 6 }, (_, index) => first[`--chart-${index + 1}`]!)
    const secondCharts = Array.from({ length: 6 }, (_, index) => second[`--chart-${index + 1}`]!)

    expect(firstCharts).not.toEqual(secondCharts)
    expect(firstCharts.every(value => /^#[0-9a-f]{6}$/.test(value))).toBe(true)
    expect(secondCharts.every(value => /^#[0-9a-f]{6}$/.test(value))).toBe(true)
    expect(new Set(firstCharts).size).toBe(6)
    expect(new Set(secondCharts).size).toBe(6)
    expect(first['--primary']).toBe('#0055ff')
    expect(first['--chart-2']).toBe('#0055ff')
  })

  it('spreads chart tones across neighbouring hues for a chromatic brand', () => {
    const theme = createBrandTheme('#0055ff')
    const hues = Array.from({ length: 6 }, (_, index) => theme[`--chart-${index + 1}`]!)
      .map((hex) => {
        const [r, g, b] = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
        const max = Math.max(r!, g!, b!)
        const min = Math.min(r!, g!, b!)
        const d = max - min
        if (d === 0) return 0
        const h = max === r ? ((g! - b!) / d) % 6 : max === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4
        return (h * 60 + 360) % 360
      })
    expect(new Set(hues.map(hue => Math.round(hue / 25))).size).toBeGreaterThanOrEqual(4)
  })

  it.each(['#000000', '#ffffff'])('keeps six chart tones distinct for extreme primary %s', (primary) => {
    for (const mode of ['light', 'cream', 'dark'] as const) {
      const theme = createBrandTheme(primary, mode)
      const charts = Array.from({ length: 6 }, (_, index) => theme[`--chart-${index + 1}`]!)

      expect(new Set(charts).size).toBe(6)
      expect(charts.every(value => /^#[0-9a-f]{6}$/.test(value))).toBe(true)
    }
  })

  it('returns only the documented CSS custom properties', () => {
    expect(Object.keys(createBrandTheme('#0055ff', 'light', '#d14a00')).sort()).toEqual([
      '--brand-link',
      '--chart-1',
      '--chart-2',
      '--chart-3',
      '--chart-4',
      '--chart-5',
      '--chart-6',
      '--nasq-brand-secondary',
      '--nasq-brand-secondary-fill',
      '--nasq-brand-secondary-fill-active',
      '--nasq-brand-secondary-fill-active-foreground',
      '--nasq-brand-secondary-fill-foreground',
      '--nasq-brand-secondary-fill-hover',
      '--nasq-brand-secondary-fill-hover-foreground',
      '--nasq-brand-secondary-foreground',
      '--nasq-brand-secondary-soft',
      '--nasq-brand-secondary-soft-foreground',
      '--primary',
      '--primary-active',
      '--primary-active-foreground',
      '--primary-fill',
      '--primary-fill-active',
      '--primary-fill-active-foreground',
      '--primary-fill-foreground',
      '--primary-fill-hover',
      '--primary-fill-hover-foreground',
      '--primary-foreground',
      '--primary-hover',
      '--primary-hover-foreground',
      '--ring',
      '--secondary',
      '--secondary-active',
      '--secondary-active-foreground',
      '--secondary-foreground',
      '--secondary-hover',
      '--secondary-hover-foreground',
      '--shell-active',
      '--shell-background',
      '--shell-foreground',
      '--shell-hover',
      '--sidebar-primary',
      '--sidebar-primary-foreground',
      '--sidebar-ring',
    ])
  })

  it('derives a secondary from the primary instead of a hardcoded blue', () => {
    const derived = derivedSecondary('#0055ff')
    expect(createBrandTheme('#0055ff')['--secondary']).toBeUndefined()
    expect(createBrandTheme('#0055ff')['--nasq-brand-secondary']).toBe(derived)
    expect(createBrandTheme('#0055ff')['--nasq-brand-secondary']).not.toBe('#2563eb')
    expect(createBrandTheme('#0055ff', 'light', 'not-a-colour')['--nasq-brand-secondary']).toBe(derived)
    expect(createBrandTheme('#0055ff', 'light', 'not-a-colour')['--secondary']).toBe(derived)
    const theme = createBrandTheme('#0055ff', 'light', '#d14a00')
    expect(theme['--primary']).toBe('#0055ff')
    expect(theme['--secondary']).toBe('#d14a00')
    expect(theme['--nasq-brand-secondary']).toBe('#d14a00')
    expect(theme['--secondary']).not.toBe(theme['--primary'])
    expect(new Set([theme['--secondary'], theme['--secondary-hover'], theme['--secondary-active']]).size).toBe(3)
    expect(contrast(theme['--nasq-brand-secondary']!, theme['--nasq-brand-secondary-foreground']!)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['#2563eb', '#d14a00', '#e3e3e4', '#ffffff', '#78ff3e'])('gives secondary text at least 4.5:1 on %s', (secondary) => {
    const theme = createBrandTheme(DEFAULT_PRIMARY, 'light', secondary)
    expect(contrast(theme['--nasq-brand-secondary']!, theme['--nasq-brand-secondary-foreground']!)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['#000000', '#ffffff', '#ffff00', '#78ff3e', '#00ffd2'])('keeps secondary soft text readable on %s', (secondary) => {
    for (const mode of ['light', 'cream', 'dark'] as const) {
      const theme = createBrandTheme('#0055ff', mode, secondary)
      expect(contrast(theme['--nasq-brand-secondary-soft']!, theme['--nasq-brand-secondary-soft-foreground']!)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(['#000000', '#ffffff', '#ffff00', '#78ff3e', '#00ffd2'])('keeps secondary fill readable on %s surfaces', (secondary) => {
    for (const mode of ['light', 'cream', 'dark'] as const) {
      const surfaces = MODE_SURFACES[mode]
      const theme = createBrandTheme('#0055ff', mode, secondary)
      expect(contrast(theme['--nasq-brand-secondary-fill']!, theme['--nasq-brand-secondary-fill-foreground']!)).toBeGreaterThanOrEqual(4.5)
      for (const surface of surfaces) {
        expect(contrast(theme['--nasq-brand-secondary-fill']!, surface), `${secondary} ${mode} ${surface}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('walks chart tones from primary to a distinct secondary', () => {
    const theme = createBrandTheme('#0055ff', 'light', '#d14a00')
    const charts = Array.from({ length: 6 }, (_, index) => theme[`--chart-${index + 1}`]!)
    expect(theme['--chart-2']).toBe('#0055ff')
    expect(theme['--chart-5']).toBe(theme['--nasq-brand-secondary-fill'])
    expect(new Set(charts).size).toBe(6)
    expect(charts).not.toEqual(Array.from({ length: 6 }, (_, index) => createBrandTheme('#0055ff')[`--chart-${index + 1}`]!))
  })

  it('keeps the primary chart family when secondary shares its hue', () => {
    const without = Array.from({ length: 6 }, (_, index) => createBrandTheme('#0055ff')[`--chart-${index + 1}`]!)
    const washed = Array.from({ length: 6 }, (_, index) => createBrandTheme('#0055ff', 'light', derivedSecondary('#0055ff'))[`--chart-${index + 1}`]!)
    expect(washed).toEqual(without)
  })

  it('reports low-contrast pairs without changing either chosen colour', () => {
    expect(brandPairContrast('#100060', '#b2ff32')).toBeGreaterThan(4.5)
    expect(brandPairContrast('#ffff00', '#ffffff')).toBeLessThan(4.5)
    for (const mode of ['light', 'cream', 'dark'] as const) {
      const theme = createBrandTheme('#ffff00', mode, '#ffffff')
      expect(theme['--primary']).toBe('#ffff00')
      expect(theme['--secondary']).toBe('#ffffff')
      expect(theme['--nasq-brand-secondary']).toBe('#ffffff')
    }
  })
})
