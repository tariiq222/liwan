import { describe, expect, it } from 'vitest'
import { createBrandTheme, DEFAULT_PRIMARY, MODE_SURFACES } from '../brandTheme'

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

function visualDistance(first: string, second: string): number {
  const parse = (hex: string) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
  const firstBytes = parse(first)
  const secondBytes = parse(second)
  return Math.sqrt(firstBytes.reduce((acc, value, index) => acc + (value - secondBytes[index]!) ** 2, 0))
}

describe('createBrandTheme', () => {
  it('uses the current reference surfaces and readable muted text baseline', () => {
    expect(MODE_SURFACES.light).toEqual(['#f6f7fb', '#ffffff', '#f8f9fc', '#eef1f7', '#f1f3f9', '#e5e8ef', '#d9dde7'])
    expect(contrast('#656c7e', '#f6f7fb')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#656c7e', '#eef1f7')).toBeGreaterThanOrEqual(4.5)
  })

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
    for (const surface of MODE_SURFACES.cream) {
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
    for (const surface of MODE_SURFACES.dark) {
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

  it.each(['#000000', '#ffffff', '#0055ff', '#d14a00', '#a855f7'])
    ('keeps every chart tone at least 3:1 against chart surfaces for %s', (primary) => {
      for (const mode of ['light', 'cream', 'dark'] as const) {
        const theme = createBrandTheme(primary, mode)
        const charts = Array.from({ length: 6 }, (_, index) => theme[`--chart-${index + 1}`]!)

        expect(new Set(charts).size, `${primary} ${mode} chart uniqueness`).toBe(6)
        for (const chart of charts) {
          for (const surface of MODE_SURFACES[mode]) {
            expect(contrast(chart, surface), `${primary} ${mode} ${chart} on ${surface}`).toBeGreaterThanOrEqual(3)
          }
        }
      }
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

  it('keeps near-neutral primaries visually separated in chart tones', () => {
    const theme = createBrandTheme('#c9c9c9')
    const charts = Array.from({ length: 6 }, (_, index) => theme[`--chart-${index + 1}`]!)

    for (let first = 0; first < charts.length; first += 1) {
      for (let second = first + 1; second < charts.length; second += 1) {
        expect(visualDistance(charts[first]!, charts[second]!)).toBeGreaterThanOrEqual(13)
      }
    }
  })

  it('returns only the primary-derived CSS custom properties', () => {
    expect(Object.keys(createBrandTheme('#0055ff')).sort()).toEqual([
      '--brand-link',
      '--chart-1',
      '--chart-2',
      '--chart-3',
      '--chart-4',
      '--chart-5',
      '--chart-6',
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
      '--primary-soft',
      '--primary-soft-foreground',
      '--ring',
      '--shell-active',
      '--shell-background',
      '--shell-foreground',
      '--shell-hover',
      '--sidebar-primary',
      '--sidebar-primary-foreground',
      '--sidebar-ring',
    ])
  })

  it.each(['#000000', '#ffffff', '#ffff00', '#0055ff', '#a855f7'])('keeps primary soft selection readable on %s', (primary) => {
    for (const mode of ['light', 'cream', 'dark'] as const) {
      const theme = createBrandTheme(primary, mode)
      expect(contrast(theme['--primary-soft']!, theme['--primary-soft-foreground']!), `${primary} ${mode}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(['#000000', '#ffffff', '#ffff00', '#0055ff', '#a855f7'])('keeps primary soft selection distinct from fill on %s', (primary) => {
    for (const mode of ['light', 'cream', 'dark'] as const) {
      const theme = createBrandTheme(primary, mode)
      expect(theme['--primary-soft']).not.toBe(theme['--primary-fill'])
      expect(contrast(theme['--primary-fill']!, theme['--primary-fill-foreground']!), `${primary} ${mode}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps charts in one primary-derived family', () => {
    const theme = createBrandTheme('#0055ff')
    const charts = Array.from({ length: 6 }, (_, index) => theme[`--chart-${index + 1}`]!)
    expect(theme['--chart-2']).toBe('#0055ff')
    expect(new Set(charts).size).toBe(6)
  })
})
