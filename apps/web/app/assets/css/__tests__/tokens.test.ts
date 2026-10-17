import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { layerFile } from '@webvue/ui/test/helpers/layerFile'
import { contrastRatio, DARK_SURFACES, LIGHT_BORDER, LIGHT_CANVAS, STATUS_TEXT } from '../../../utils/webvuePalette'

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
    expect(found.get('--primary')?.toLowerCase()).toBe('#007ff8')
    const solid = { '--primary-solid': '#0066cc', '--primary-solid-hover': '#0052a3', '--primary-solid-active': '#00478f' }
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
