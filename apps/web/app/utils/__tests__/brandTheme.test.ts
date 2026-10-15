import { describe, expect, it } from 'vitest'
import { CATEGORICAL_CHART_COLORS, createBrandTheme, darkLink, darkSolid, DEFAULT_PRIMARY, MODE_SURFACES, STATUS_CHART_COLORS } from '../brandTheme'
import { contrastRatio, DARK_SURFACES } from '../nasqPalette'

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
    for (const mode of ['light', 'dark'] as const) {
      const surfaces = MODE_SURFACES[mode]
      const theme = createBrandTheme(primary, mode)
      expect(contrast(theme['--primary-fill']!, theme['--primary-fill-foreground']!)).toBeGreaterThanOrEqual(4.5)
      for (const surface of surfaces) {
        expect(contrast(theme['--primary-fill']!, surface), `${primary} ${mode} ${surface}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it.each(['#000000', '#ffffff', '#808080', '#ffff00', DEFAULT_PRIMARY])('keeps fill hover and pressed tones distinct and readable for %s', (primary) => {
    for (const mode of ['light', 'dark'] as const) {
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

  it('takes chart series 1 from the tenant primary and keeps series 2-6 fixed', () => {
    const first = createBrandTheme('#0055ff')
    const second = createBrandTheme(DEFAULT_PRIMARY)
    const series = (theme: Record<string, string>) => Array.from({ length: 6 }, (_, index) => theme[`--chart-${index + 1}`]!)

    expect(first['--chart-1']).toBe('#0055ff')
    expect(first['--chart-1']).not.toBe(second['--chart-1'])
    expect(series(first).slice(1)).toEqual([...CATEGORICAL_CHART_COLORS.light])
    expect(series(second).slice(1)).toEqual([...CATEGORICAL_CHART_COLORS.light])
    expect(series(createBrandTheme('#0055ff', 'dark')).slice(1)).toEqual([...CATEGORICAL_CHART_COLORS.dark])
    expect(new Set(series(first)).size).toBe(6)
    expect(new Set(series(second)).size).toBe(6)
  })

  it('replaces a fixed series that the tenant primary collides with', () => {
    const teal = createBrandTheme('#0d9488')
    const charts = Array.from({ length: 6 }, (_, index) => teal[`--chart-${index + 1}`]!)
    expect(charts[1]).toBe('#ea580c')
    expect(charts).not.toContain('#0d9488')
    expect(new Set(charts).size).toBe(6)
  })

  // A chart sits on a card: white in light mode, the page surfaces in dark mode.
  const CHART_SURFACES = { light: ['#ffffff'], dark: [DARK_SURFACES.canvas, DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.elevated] } as const

  it.each(['#000000', '#ffffff', '#0055ff', '#d14a00', '#a855f7', DEFAULT_PRIMARY])
    ('keeps every chart and status series at least 3:1 against the card surface for %s', (primary) => {
      for (const mode of ['light', 'dark'] as const) {
        const theme = createBrandTheme(primary, mode)
        const charts = Array.from({ length: 6 }, (_, index) => theme[`--chart-${index + 1}`]!)
        const status = Object.keys(STATUS_CHART_COLORS[mode]).map(key => theme[`--chart-status-${key}`]!)

        expect(new Set(charts).size, `${primary} ${mode} chart uniqueness`).toBe(6)
        for (const color of [...charts, ...status]) {
          for (const surface of CHART_SURFACES[mode]) {
            expect(contrast(color, surface), `${primary} ${mode} ${color} on ${surface}`).toBeGreaterThanOrEqual(3)
          }
        }
      }
    })

  it('exports the status series as the fixed colours the status badges use, apart from the tenant', () => {
    for (const mode of ['light', 'dark'] as const) {
      const a = createBrandTheme('#0055ff', mode)
      const b = createBrandTheme('#d14a00', mode)
      for (const [key, value] of Object.entries(STATUS_CHART_COLORS[mode])) {
        expect(a[`--chart-status-${key}`]).toBe(value)
        expect(b[`--chart-status-${key}`]).toBe(value)
      }
    }
  })

  it.each(['#000000', '#ffffff'])('keeps six chart tones distinct for extreme primary %s', (primary) => {
    for (const mode of ['light', 'dark'] as const) {
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
      '--chart-status-error',
      '--chart-status-info',
      '--chart-status-neutral',
      '--chart-status-success',
      '--chart-status-warning',
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
      '--primary-solid',
      '--primary-solid-foreground',
      '--primary-solid-hover',
      '--primary-solid-hover-foreground',
      '--ring',
      '--sidebar-primary',
      '--sidebar-primary-foreground',
      '--sidebar-ring',
    ])
  })

  it.each(['#000000', '#ffffff', '#ffff00', '#0055ff', '#a855f7'])('keeps primary soft selection readable on %s', (primary) => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = createBrandTheme(primary, mode)
      expect(contrast(theme['--primary-soft']!, theme['--primary-soft-foreground']!), `${primary} ${mode}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(['#000000', '#ffffff', '#ffff00', '#0055ff', '#a855f7'])('keeps primary soft selection distinct from fill on %s', (primary) => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = createBrandTheme(primary, mode)
      expect(theme['--primary-soft']).not.toBe(theme['--primary-fill'])
      expect(contrast(theme['--primary-fill']!, theme['--primary-fill-foreground']!), `${primary} ${mode}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('Nasq palette in the brand engine', () => {
  it('defaults to Nasq midnight', () => {
    expect(DEFAULT_PRIMARY).toBe('#13234a')
  })

  it('no longer derives shell colours from the tenant primary', () => {
    const theme = createBrandTheme('#e11d48', 'light')
    for (const key of ['--shell-background', '--shell-foreground', '--shell-hover', '--shell-active']) {
      expect(theme).not.toHaveProperty(key)
    }
  })

  it.each(['#000000', '#ffffff', '#c8f031', '#ffff00', '#13234a', '#0055ff', '#e11d48', '#7c3aed'])(
    'keeps %s readable on every surface in both modes',
    (primary) => {
      for (const mode of ['light', 'dark'] as const) {
        const theme = createBrandTheme(primary, mode)
        for (const surface of MODE_SURFACES[mode]) {
          expect(contrastRatio(theme['--brand-link']!, surface)).toBeGreaterThanOrEqual(4.5)
          expect(contrastRatio(theme['--ring']!, surface)).toBeGreaterThanOrEqual(3)
        }
      }
    },
  )

  // Owner amendment 4 (CP2): the dark solid primary must stand out from the page, not read as a grey control.
  const PAGE_SURFACES = [DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.elevated]
  const SAMPLED_PRIMARIES = [DEFAULT_PRIMARY, '#000000', '#4c0519', '#18181b', '#0055ff', '#e11d48', '#7c3aed', '#0f766e', '#a855f7', '#facc15', '#ffffff', '#c8f031']
  function saturation(hex: string): number {
    const [r, g, b] = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
  }

  it('keeps the dark solid primary readable and visible for sampled tenant primaries', () => {
    for (const primary of SAMPLED_PRIMARIES) {
      const theme = createBrandTheme(primary, 'dark')
      const solid = theme['--primary-solid']!
      expect(contrastRatio(solid, theme['--primary-solid-foreground']!), `${primary} label`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(theme['--primary-solid-hover']!, theme['--primary-solid-hover-foreground']!), `${primary} hover label`).toBeGreaterThanOrEqual(4.5)
      for (const surface of PAGE_SURFACES) {
        expect(contrastRatio(solid, surface), `${primary} on ${surface}`).toBeGreaterThanOrEqual(3)
      }
      // A chromatic brand keeps visible colour instead of greying out like --brand-link.
      if (saturation(primary) >= 0.12) expect(saturation(solid), `${primary} saturation`).toBeGreaterThanOrEqual(0.5)
      // The tenant choice itself is never rewritten.
      expect(theme['--primary']).toBe(primary)
    }
  })

  it('derives the default dark solid from midnight, never lime, and keeps light mode on midnight', () => {
    const dark = createBrandTheme(DEFAULT_PRIMARY, 'dark')
    expect(dark['--primary-solid']).toBe('#3c66cd')
    expect(dark['--primary-solid-foreground']).toBe('#ffffff')
    expect(dark['--primary-solid']).not.toBe('#c8f031')
    // Links, text-primary and focus keep the lighter text tone.
    expect(dark['--brand-link']).toBe(darkLink(DEFAULT_PRIMARY))
    // The link keeps the brand hue (periwinkle, not the grey a white mix gives) and stands 4.5:1 off every dark surface.
    expect(saturation(dark['--brand-link']!)).toBeGreaterThanOrEqual(0.4)
    for (const surface of MODE_SURFACES.dark) expect(contrastRatio(dark['--brand-link']!, surface)).toBeGreaterThanOrEqual(4.5)
    const light = createBrandTheme(DEFAULT_PRIMARY, 'light')
    expect(light['--primary']).toBe('#13234a')
    expect(light['--brand-link']).toBe('#13234a')
  })

  it('keeps a tenant colour that already passes as its own dark solid', () => {
    for (const primary of ['#e11d48', '#facc15', '#ffffff']) {
      expect(createBrandTheme(primary, 'dark')['--primary-solid']).toBe(primary)
    }
  })
})

describe('darkSolid input', () => {
  it('treats an invalid colour as the Nasq default', () => {
    expect(darkSolid('not-a-colour')).toBe(darkSolid('#13234a'))
  })
})
