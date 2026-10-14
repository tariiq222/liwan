import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DARK_SURFACES } from '../../../utils/nasqPalette'
import { createBrandTheme, DEFAULT_PRIMARY } from '../../../utils/brandTheme'

const sheet = (name: string) => readFileSync(resolve(import.meta.dirname, '..', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

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

describe('the module rail is fixed Nasq midnight', () => {
  for (const selector of [':root', '.dark']) {
    it(`${selector} declares --nasq-rail and --nasq-rail-deep as literal colours`, () => {
      const found = declarations(ruleBodies(sheet('tokens.css'), selector))
      expect(found.get('--nasq-rail')).toMatch(LITERAL)
      expect(found.get('--nasq-rail-deep')).toMatch(LITERAL)
    })
  }

  it('.nasq-module-rail paints with the rail tokens and nothing tenant-derived', () => {
    const rail = ruleBodies(sheet('shell.css'), '.nasq-module-rail')
    expect(rail).toContain('var(--nasq-rail)')
    expect(rail).toContain('var(--nasq-rail-deep)')
    expect(rail).not.toMatch(/--primary|--brand|--ui-primary|--color-brand/)
  })
})

describe('dark surfaces', () => {
  it('tokens.css .dark matches DARK_SURFACES', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    const expected: Record<string, string> = {
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
  it('tokens.css .dark matches createBrandTheme for the default midnight', () => {
    const found = declarations(ruleBodies(sheet('tokens.css'), '.dark'))
    const theme = createBrandTheme(DEFAULT_PRIMARY, 'dark')
    for (const token of ['--primary-solid', '--primary-solid-foreground', '--primary-solid-hover', '--primary-solid-hover-foreground']) {
      expect(found.get(token), token).toBeDefined()
      expect(found.get(token)?.toLowerCase(), token).toBe(theme[token])
    }
  })
})
