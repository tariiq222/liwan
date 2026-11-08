import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { layerFile } from '@liwan/ui/test/helpers/layerFile'
import {
  APP_TILES, contrastRatio, DARK_MID_TEXT, DARK_MUTED_TEXT, DARK_NAV_ACTIVE, DARK_PRIMARY_FILL, DARK_PRIMARY_LABEL, DARK_SURFACES, DARK_TEXT,
  INK, INK_ACTIVE, INK_HOVER, LIGHT_BORDER, LIGHT_CANVAS, LIGHT_INK, LIGHT_MID_TEXT, LIGHT_MUTED_TEXT, LIGHT_SIDEBAR, LIGHT_SOFT, STATUS_TEXT,
} from '../../../utils/liwanPalette'

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

describe('the sidebar is a fixed column on the sidebar tone', () => {
  it('paints with the sidebar and rail tokens and nothing tenant-derived', () => {
    const rail = ruleBodies(sheet('shell.css'), '.liwan-sidebar')
    expect(rail).toContain('var(--liwan-sidebar)')
    expect(rail).toContain('var(--liwan-rail-border)')
    expect(rail).not.toMatch(/gradient|--primary|--brand|--color-brand/)
  })

  it('keeps the inactive and active ink readable on their surfaces', () => {
    const light = declarations(ruleBodies(sheet('tokens.css'), ':root'))
    const dark = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    expect(contrastRatio(light.get('--liwan-rail-ink')!, LIGHT_SIDEBAR)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light.get('--liwan-rail-active-ink')!, light.get('--liwan-rail-active')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark.get('--liwan-rail-ink')!, DARK_SURFACES.sidebar)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark.get('--liwan-rail-active-ink')!, dark.get('--liwan-rail-active')!)).toBeGreaterThanOrEqual(4.5)
    // The active chip is the solid primary under its own label in both modes.
    expect(light.get('--liwan-chip-active')).toBe('var(--primary-solid)')
    expect(light.get('--liwan-chip-active-ink')).toBe('var(--primary-solid-foreground)')
    expect(dark.has('--liwan-chip-active')).toBe(false)
  })
})

describe('dark surfaces', () => {
  it('tokens.css .dark matches DARK_SURFACES', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    const expected: Record<string, string> = {
      '--liwan-canvas': DARK_SURFACES.canvas,
      '--liwan-sidebar': DARK_SURFACES.sidebar,
      '--liwan-nav-active': DARK_NAV_ACTIVE,
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
  it('tokens.css :root declares the ink solid primary under a white label', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), ':root'))
    expect(found.get('--primary')?.toLowerCase()).toBe(INK)
    const solid = { '--primary-solid': INK, '--primary-solid-hover': INK_HOVER, '--primary-solid-active': INK_ACTIVE }
    for (const [token, value] of Object.entries(solid)) {
      expect(found.get(token)?.toLowerCase(), token).toBe(value)
      expect(contrastRatio('#ffffff', value), `${token} under white text`).toBeGreaterThanOrEqual(7)
    }
    for (const token of ['--primary-solid-foreground', '--primary-solid-hover-foreground', '--primary-solid-active-foreground']) {
      expect(found.get(token), token).toBeDefined()
    }
  })

  it('tokens.css .dark inverts the solid primary: a light fill under a near-black label', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    expect(found.get('--primary-solid')?.toLowerCase()).toBe(DARK_PRIMARY_FILL)
    expect(found.get('--primary-solid-foreground')?.toLowerCase()).toBe(DARK_PRIMARY_LABEL)
    for (const token of ['--primary-solid', '--primary-solid-hover', '--primary-solid-active']) {
      expect(contrastRatio(DARK_PRIMARY_LABEL, found.get(token)!), `${token} under the dark label`).toBeGreaterThanOrEqual(7)
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
    expect(declarations(ruleBodies(tokens, ':root')).get('--liwan-canvas')?.toLowerCase()).toBe(LIGHT_CANVAS)
    const shell = sheet('shell.css')
    for (const selector of ['.liwan-shell', '.liwan-shell-workspace', '.liwan-shell-main']) {
      expect(declarations(ruleBodies(shell, selector)).get('background'), selector).toBe('var(--liwan-canvas)')
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

  it('keeps the neutral status series visible on white, the canvas and sand', () => {
    const neutral = declarations(ruleBodies(sheet('tokens.css'), ':root')).get('--chart-status-neutral')!
    for (const surface of [LIGHT_CANVAS, LIGHT_SIDEBAR, LIGHT_SOFT]) expect(contrastRatio(neutral, surface), surface).toBeGreaterThanOrEqual(3)
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

describe('approved ink palette', () => {
  const light = () => declarations(ruleBodies(sheet('tokens.css'), ':root'))
  const dark = () => declarations(ruleBodies(sheet('tokens.css'), '.dark'))
  const hex = (value: string | undefined) => value?.toLowerCase()

  it('paints links, titles, secondary text and the surfaces in light mode', () => {
    const found = light()
    expect(hex(found.get('--brand-link'))).toBe(INK)
    expect(hex(found.get('--ui-text-highlighted'))).toBe(LIGHT_INK)
    expect(hex(found.get('--ui-text'))).toBe(LIGHT_INK)
    expect(hex(found.get('--ui-text-toned'))).toBe(LIGHT_MID_TEXT)
    expect(hex(found.get('--ui-text-muted'))).toBe(LIGHT_MUTED_TEXT)
    expect(hex(found.get('--liwan-sidebar'))).toBe(LIGHT_SIDEBAR)
    expect(hex(found.get('--ui-bg-muted'))).toBe(LIGHT_SOFT)
    expect(hex(found.get('--ui-border'))).toBe(LIGHT_BORDER)
  })

  it('declares the dark ink brand tone and the charcoal text roles', () => {
    const found = dark()
    for (const token of ['--brand-link', '--ring', '--sidebar-ring', '--liwan-rail-active-ink']) expect(hex(found.get(token)), token).toBe(DARK_PRIMARY_FILL)
    expect(hex(found.get('--ui-text'))).toBe(DARK_TEXT)
    expect(hex(found.get('--ui-text-toned'))).toBe(DARK_MID_TEXT)
    expect(hex(found.get('--ui-text-muted'))).toBe(DARK_MUTED_TEXT)
  })

  it('keeps dark body text at 4.5:1 on every dark surface', () => {
    const found = dark()
    for (const surface of [DARK_SURFACES.canvas, DARK_SURFACES.sidebar, DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.elevated, DARK_SURFACES.accented]) {
      for (const token of ['--ui-text', '--ui-text-toned', '--ui-text-muted', '--ui-text-highlighted']) {
        expect(contrastRatio(found.get(token)!, surface), `${token} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('leaves no lavender or earlier identity value in the token sheet', () => {
    const css = sheet('tokens.css').toLowerCase()
    for (const old of ['#7843c6', '#c2aae5', '#eee8f8', '#6639a8', '#56308f', '#007ff8', '#0066cc', '#c6f432', '#13234a', '#0052a3', '#00478f']) expect(css, old).not.toContain(old)
  })

  for (const mode of ['light', 'dark'] as const) {
    it(`${mode} chart colours reach 3:1 on their surfaces and stay distinct`, () => {
      const found = mode === 'light' ? light() : dark()
      const surfaces = mode === 'light' ? [LIGHT_CANVAS, LIGHT_SIDEBAR] : [DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.canvas]
      const colours = [1, 2, 3, 4, 5, 6].map(i => found.get(`--chart-${i}`)!)
      for (const colour of colours) for (const surface of surfaces) expect(contrastRatio(colour, surface), `${colour} on ${surface}`).toBeGreaterThanOrEqual(3)
      colours.forEach((first, i) => colours.slice(i + 1).forEach(second => expect(colourDistance(first, second), `${first} vs ${second}`).toBeGreaterThan(60)))
    })
  }

  it('keeps the first chart colour led by the ink primary', () => {
    expect(hex(light().get('--chart-1'))).toBe(INK)
  })

  it('keeps status text readable on the white surfaces', () => {
    for (const text of Object.values(STATUS_TEXT.light)) for (const surface of [LIGHT_CANVAS, LIGHT_SOFT]) expect(contrastRatio(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
  })
})

describe('per-application identity', () => {
  const css = () => sheet('app-identity.css')
  const hex = (value: string | undefined) => value?.toLowerCase()

  it('declares every paid application tile (light and dark) and button shade', () => {
    const light = declarations(ruleBodies(css(), ':root'))
    const dark = declarations(ruleBodies(css(), '.dark'))
    for (const [app, tile] of Object.entries(APP_TILES)) {
      expect(hex(light.get(`--liwan-app-${app}`)), `${app} tile`).toBe(tile.light)
      expect(hex(dark.get(`--liwan-app-${app}`)), `${app} dark tile`).toBe(tile.dark)
      expect(hex(light.get(`--liwan-app-${app}-action`)), `${app} action`).toBe(tile.action)
    }
  })

  it('keeps tinted chips and accent text at AA on their own tint (light and dark)', () => {
    const hex = (value: number[]) => `#${value.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
    const rgb = (value: string) => [1, 3, 5].map(start => Number.parseInt(value.slice(start, start + 2), 16))
    const mixWith = (fg: string, bg: string, share: number) => hex(rgb(fg).map((channel, index) => channel * share + rgb(bg)[index]! * (1 - share)))
    for (const [app, tile] of Object.entries(APP_TILES)) {
      const lightText = mixWith(tile.action, '#000000', 0.8)
      expect(contrastRatio(lightText, mixWith(tile.action, '#ffffff', 0.12)), `${app} light chip`).toBeGreaterThanOrEqual(4.5)
      const darkText = mixWith(tile.dark, '#ffffff', 0.75)
      expect(contrastRatio(darkText, mixWith(tile.dark, DARK_SURFACES.bg, 0.14)), `${app} dark chip`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('defines the accent, its text, the ring and the first chart series for a paid application only', () => {
    const sheetText = css()
    expect(sheetText).toContain('--app-accent: var(--app-action);')
    expect(sheetText).toContain('--app-accent: var(--app-tile);')
    expect(sheetText).toContain('--chart-1: var(--app-accent);')
    expect(sheetText).toContain('[role="progressbar"] > [data-slot="indicator"].bg-primary')
    for (const free of ['chat', 'tasks', 'meetings', 'documents', 'operations', 'ai']) expect(sheetText, free).not.toContain(`data-app="${free}"`)
  })

  it('scopes a paid application to its tile and button shade and leaves free applications on the ink', () => {
    const sheetText = css()
    for (const app of Object.keys(APP_TILES)) expect(sheetText).toContain(`[data-app="${app}"] { --app-tile: var(--liwan-app-${app}); --app-action: var(--liwan-app-${app}-action); }`)
    for (const free of ['chat', 'tasks', 'meetings', 'documents', 'operations', 'ai']) expect(sheetText, free).not.toContain(`data-app="${free}"`)
  })
})

/** Euclidean distance in sRGB: a coarse "are these two swatches visibly different" guard. */
function colourDistance(first: string, second: string): number {
  const channels = (value: string) => [1, 3, 5].map(start => Number.parseInt(value.slice(start, start + 2), 16))
  const [a, b] = [channels(first), channels(second)]
  return Math.hypot(...a.map((channel, i) => channel - b[i]!))
}
