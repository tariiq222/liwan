import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { layerFile } from '@webvue/ui/test/helpers/layerFile'
import { contrastRatio, DARK_SURFACES, LIGHT_CANVAS } from '../../../utils/webvuePalette'

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

const LITERAL = /^#[0-9a-f]{6}$/i

describe('the module rail is fixed WebVue midnight', () => {
  for (const selector of [':root', '.dark']) {
    it(`${selector} declares --webvue-rail and --webvue-rail-deep as literal colours`, () => {
      const found = declarations(ruleBodies(sheet('tokens.css'), selector))
      expect(found.get('--webvue-rail')).toMatch(LITERAL)
      expect(found.get('--webvue-rail-deep')).toMatch(LITERAL)
    })
  }

  it('.webvue-module-rail paints with the rail tokens and nothing tenant-derived', () => {
    const rail = ruleBodies(sheet('shell.css'), '.webvue-module-rail')
    expect(rail).toContain('var(--webvue-rail)')
    expect(rail).toContain('var(--webvue-rail-deep)')
    expect(rail).not.toMatch(/--primary|--brand|--ui-primary|--color-brand/)
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

describe('dark solid primary defaults', () => {
  it('tokens.css .dark declares the fixed solid primary tokens', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    for (const token of ['--primary-solid', '--primary-solid-foreground', '--primary-solid-hover', '--primary-solid-hover-foreground']) {
      expect(found.get(token), token).toBeDefined()
    }
  })
})

describe('page canvas and rail', () => {
  it('paints the shell on the canvas token and keeps cards on --ui-bg', () => {
    const tokens = sheet('tokens.css')
    expect(declarations(ruleBodies(tokens, ':root')).get('--webvue-canvas')?.toLowerCase()).toBe(LIGHT_CANVAS)
    const shell = sheet('shell.css')
    for (const selector of ['.webvue-shell', '.webvue-shell-workspace', '.webvue-shell-main']) {
      expect(declarations(ruleBodies(shell, selector)).get('background'), selector).toBe('var(--webvue-canvas)')
    }
  })

  it('keeps the dark rail distinguishable from the page canvas and the cards', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    const rail = found.get('--webvue-rail')!
    expect(contrastRatio(rail, DARK_SURFACES.canvas)).toBeGreaterThanOrEqual(1.35)
    expect(contrastRatio(found.get('--webvue-rail-deep')!, DARK_SURFACES.canvas)).toBeGreaterThanOrEqual(1.2)
    expect(contrastRatio('#ffffff', found.get('--webvue-rail-deep')!)).toBeGreaterThanOrEqual(4.5)
    expect(found.get('--webvue-rail-edge')).toBeDefined()
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
