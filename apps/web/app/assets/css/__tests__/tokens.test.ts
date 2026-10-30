import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { layerFile } from '@webvue/ui/test/helpers/layerFile'
import {
  contrastRatio, DARK_PRIMARY_ACCENT, DARK_PRIMARY_FILL, DARK_SAND, DARK_SURFACES, DARK_TEXT, LIGHT_ACTIVE_TINT, LIGHT_BORDER,
  LIGHT_CANVAS, LIGHT_INK, LIGHT_MUTED_TEXT, LIGHT_SAND, STATUS_TEXT, WEBVUE_PRIMARY,
} from '../../../utils/webvuePalette'

const sheet = (name: string) => readFileSync(layerFile(`app/assets/css/${name}`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of every innermost rule whose selector is exactly `selector`, joined. */
function ruleBodies(css: string, selector: string): string {
  const bodies: string[] = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.trim() === selector) bodies.push(match[2]!)
  }
  return bodies.join('\n')
}

function declarations(body: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon > 0) found.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim())
  }
  return found
}

describe('the module rail is a white floating card', () => {
  it('paints with the surface and rail tokens and nothing tenant-derived', () => {
    const rail = ruleBodies(sheet('shell.css'), '.webvue-module-rail')
    expect(rail).toContain('var(--ui-bg)')
    expect(rail).toContain('var(--webvue-rail-border)')
    expect(rail).not.toMatch(/gradient|--primary|--brand|--color-brand/)
  })

  it('keeps the inactive ink and the active ink readable on their surfaces', () => {
    const light = declarations(ruleBodies(sheet('tokens.css'), ':root'))
    const dark = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    expect(contrastRatio(light.get('--webvue-rail-ink')!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light.get('--webvue-rail-active-ink')!, light.get('--webvue-rail-active')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark.get('--webvue-rail-ink')!, DARK_SURFACES.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark.get('--webvue-rail-active-ink')!, dark.get('--webvue-rail-active')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light.get('--webvue-rail-active-ink')!, light.get('--webvue-chip-active')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light.get('--webvue-rail-ink')!, light.get('--webvue-chip')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark.get('--webvue-rail-active-ink')!, dark.get('--webvue-chip-active')!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('dark surfaces', () => {
  it('tokens.css .dark matches DARK_SURFACES', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    const expected: Record<string, string> = {
      '--webvue-canvas': DARK_SURFACES.canvas,
      '--ui-bg': DARK_SURFACES.bg,
      '--ui-bg-muted': DARK_SURFACES.muted,
      '--ui-bg-elevated': DARK_SURFACES.elevated,
      '--ui-bg-accented': DARK_SURFACES.accented,
      '--ui-border': DARK_SURFACES.border,
      '--ui-border-muted': DARK_SURFACES.borderMuted,
      '--ui-border-accented': DARK_SURFACES.borderAccented,
    }
    for (const [token, value] of Object.entries(expected)) expect(found.get(token)?.toLowerCase(), token).toBe(value)
  })
})

describe('solid primary', () => {
  it('tokens.css :root declares one text-bearing solid primary for both modes, deeper than the accent', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), ':root'))
    expect(found.get('--primary')?.toLowerCase()).toBe(WEBVUE_PRIMARY)
    const solid = { '--primary-solid': WEBVUE_PRIMARY, '--primary-solid-hover': '#4a3374', '--primary-solid-active': '#3e2b63' }
    for (const [token, value] of Object.entries(solid)) {
      expect(found.get(token)?.toLowerCase(), token).toBe(value)
      expect(contrastRatio('#ffffff', value), `${token} under white text`).toBeGreaterThanOrEqual(4.5)
    }
    for (const token of ['--primary-solid-foreground', '--primary-solid-hover-foreground', '--primary-solid-active-foreground']) {
      expect(found.get(token), token).toBeDefined()
    }
  })

  it('text-bearing primary fills resolve to the solid family, not the accent', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), ':root'))
    expect(found.get('--primary-fill')).toBe('var(--primary-solid)')
    expect(found.get('--primary-fill-hover')).toBe('var(--primary-solid-hover)')
    expect(found.get('--primary-fill-active')).toBe('var(--primary-solid-active)')
  })
})

describe('page canvas', () => {
  it('paints the shell on the canvas token and keeps cards on --ui-bg', () => {
    const tokens = sheet('tokens.css')
    expect(declarations(ruleBodies(tokens, ':root')).get('--webvue-canvas')?.toLowerCase()).toBe(LIGHT_CANVAS)
    const shell = sheet('shell.css')
    for (const selector of ['.webvue-shell', '.webvue-shell-workspace', '.webvue-shell-main']) {
      expect(declarations(ruleBodies(shell, selector)).get('background'), selector).toBe('var(--webvue-canvas)')
    }
  })
})

describe('dark brand tone and chart defaults', () => {
  it('tokens.css .dark declares the brand tone, rings and chart colours', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    const tokens = ['--brand-link', '--ring', '--sidebar-ring', ...[1, 2, 3, 4, 5, 6].map(i => `--chart-${i}`), ...['success', 'info', 'warning', 'error', 'neutral'].map(k => `--chart-status-${k}`)]
    for (const token of tokens) expect(found.get(token), token).toBeDefined()
  })

  it('tokens.css :root declares the chart colours', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), ':root'))
    const tokens = [...[1, 2, 3, 4, 5, 6].map(i => `--chart-${i}`), ...['success', 'info', 'warning', 'error', 'neutral'].map(k => `--chart-status-${k}`)]
    for (const token of tokens) expect(found.get(token), token).toBeDefined()
  })

  it('keeps the default dark brand tone readable on the dark surfaces', () => {
    const link = declarations(ruleBodies(sheet('tokens.css'), '.dark')).get('--brand-link')!
    for (const surface of Object.values(DARK_SURFACES)) expect(contrastRatio(link, surface), surface).toBeGreaterThanOrEqual(4.5)
  })
})

describe('status badge text', () => {
  // The indicator colours are the library's own (Nuxt UI 500 step in light mode, 400 in dark mode); the soft fill
  // is the percentage tokens.css mixes into the card surface.
  const INDICATOR = {
    light: { success: '#22c55e', warning: '#eab308', danger: '#ef4444', info: '#3b82f6' },
    dark: { success: '#4ade80', warning: '#facc15', danger: '#f87171', info: '#60a5fa' },
  } as const
  const SURFACE = { light: '#ffffff', dark: DARK_SURFACES.bg } as const
  const channels = (hex: string) => [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16))
  function mixed(indicator: string, percent: number, surface: string): string {
    const [a, b] = [channels(indicator), channels(surface)]
    return `#${a.map((value, i) => Math.round(value * percent / 100 + b[i]! * (100 - percent) / 100).toString(16).padStart(2, '0')).join('')}`
  }

  for (const mode of ['light', 'dark'] as const) {
    const selector = mode === 'light' ? ':root' : '.dark'
    it(`${selector} declares the palette status text and it is at least 4.5:1 on each soft fill`, () => {
      const root = declarations(ruleBodies(sheet('tokens.css'), ':root'))
      const found = mode === 'light' ? root : declarations(ruleBodies(sheet('tokens.css'), '.dark'))
      for (const tone of ['success', 'warning', 'danger', 'info'] as const) {
        const foreground = found.get(`--status-${tone}-foreground`)?.toLowerCase()
        expect(foreground, tone).toBe(STATUS_TEXT[mode][tone])
        const percent = Number(/color-mix\(in srgb, var\(--status-\w+\) (\d+)%/.exec(root.get(`--status-${tone}-soft`) ?? '')?.[1])
        const soft = mixed(INDICATOR[mode][tone], percent, SURFACE[mode])
        expect(contrastRatio(foreground!, soft), `${mode} ${tone}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})

describe('hairline border', () => {
  it('tokens.css :root sets the light hairline', () => {
    expect(declarations(ruleBodies(sheet('tokens.css'), ':root')).get('--ui-border')?.toLowerCase()).toBe(LIGHT_BORDER)
  })
})

describe('approved lavender and sand palette', () => {
  const light = () => declarations(ruleBodies(sheet('tokens.css'), ':root'))
  const dark = () => declarations(ruleBodies(sheet('tokens.css'), '.dark'))
  const hex = (value: string | undefined) => value?.toLowerCase()

  it('paints links, titles, secondary text, sand and the active tint in light mode', () => {
    const found = light()
    expect(hex(found.get('--brand-link'))).toBe(WEBVUE_PRIMARY)
    expect(hex(found.get('--ui-text-highlighted'))).toBe(LIGHT_INK)
    expect(hex(found.get('--ui-text'))).toBe(LIGHT_INK)
    expect(hex(found.get('--ui-text-muted'))).toBe(LIGHT_MUTED_TEXT)
    expect(hex(found.get('--webvue-sand'))).toBe(LIGHT_SAND)
    expect(hex(found.get('--webvue-nav-active'))).toBe(LIGHT_ACTIVE_TINT)
    expect(hex(found.get('--webvue-rail-active'))).toBe(LIGHT_ACTIVE_TINT)
  })

  it('keeps secondary text at 4.5:1 on white, canvas and sand', () => {
    for (const surface of ['#ffffff', LIGHT_CANVAS, LIGHT_SAND]) expect(contrastRatio(LIGHT_MUTED_TEXT, surface), surface).toBeGreaterThanOrEqual(4.5)
  })

  it('declares the dark lavender accent and the 5.02:1 text-bearing fill', () => {
    const found = dark()
    for (const token of ['--primary', '--brand-link', '--ring', '--sidebar-ring', '--webvue-rail-active-ink']) expect(hex(found.get(token)), token).toBe(DARK_PRIMARY_ACCENT)
    expect(hex(found.get('--primary-solid'))).toBe(DARK_PRIMARY_FILL)
    for (const token of ['--primary-solid', '--primary-solid-hover', '--primary-solid-active']) {
      expect(contrastRatio('#ffffff', found.get(token)!), `${token} under white text`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrastRatio('#ffffff', DARK_PRIMARY_FILL)).toBeGreaterThanOrEqual(5)
  })

  it('keeps dark body text and sand text at 4.5:1 on every dark surface', () => {
    const found = dark()
    expect(hex(found.get('--ui-text'))).toBe(DARK_TEXT)
    expect(hex(found.get('--ui-text-muted'))).toBe(DARK_SAND)
    for (const surface of Object.values(DARK_SURFACES).filter(value => value !== DARK_SURFACES.border && value !== DARK_SURFACES.borderMuted && value !== DARK_SURFACES.borderAccented)) {
      for (const token of ['--ui-text', '--ui-text-toned', '--ui-text-muted', '--ui-text-highlighted']) {
        expect(contrastRatio(found.get(token)!, surface), `${token} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('leaves no blue or lime identity value behind', () => {
    const css = sheet('tokens.css').toLowerCase()
    for (const old of ['#007ff8', '#0066cc', '#c6f432', '#13234a', '#0052a3', '#00478f']) expect(css, old).not.toContain(old)
  })

  for (const mode of ['light', 'dark'] as const) {
    it(`${mode} chart colours reach 3:1 on their surfaces and stay distinct`, () => {
      const found = mode === 'light' ? light() : dark()
      const surfaces = mode === 'light' ? ['#ffffff', LIGHT_CANVAS] : [DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.elevated]
      const colours = [1, 2, 3, 4, 5, 6].map(i => found.get(`--chart-${i}`)!)
      for (const colour of colours) for (const surface of surfaces) expect(contrastRatio(colour, surface), `${colour} on ${surface}`).toBeGreaterThanOrEqual(3)
      colours.forEach((first, i) => colours.slice(i + 1).forEach(second => expect(colourDistance(first, second), `${first} vs ${second}`).toBeGreaterThan(60)))
    })
  }

  it('keeps the first chart colour led by the primary', () => {
    expect(hex(light().get('--chart-1'))).toBe(WEBVUE_PRIMARY)
    expect(hex(dark().get('--chart-1'))).toBe(DARK_PRIMARY_ACCENT)
  })

  it('keeps the violet tag hue distinct from the primary in both modes', () => {
    expect(colourDistance(light().get('--accent-violet-fg')!, WEBVUE_PRIMARY)).toBeGreaterThan(60)
    expect(colourDistance(dark().get('--accent-violet-fg')!, DARK_PRIMARY_ACCENT)).toBeGreaterThan(40)
  })

  it('keeps status text readable on sand and the white surfaces', () => {
    for (const text of Object.values(STATUS_TEXT.light)) for (const surface of ['#ffffff', LIGHT_SAND]) expect(contrastRatio(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
  })
})

/** Euclidean distance in sRGB: a coarse "are these two swatches visibly different" guard. */
function colourDistance(first: string, second: string): number {
  const channels = (value: string) => [1, 3, 5].map(start => Number.parseInt(value.slice(start, start + 2), 16))
  const [a, b] = [channels(first), channels(second)]
  return Math.hypot(...a.map((channel, i) => channel - b[i]!))
}
