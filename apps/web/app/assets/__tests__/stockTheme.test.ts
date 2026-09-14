import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The customer UI renders with Nuxt UI v4's stock recipes (Figma "Nuxt UI v4
// (Community)"). The only theme inputs are the brand primary from settings,
// the neutral palette, the Arabic font and the display modes.
const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), 'utf8')
const config = read('../../app.config.ts')
const tokens = read('../css/tokens.css')
const comps = read('../css/components.css')
const shell = read('../css/shell.css')

describe('stock Nuxt UI theme', () => {
  it('app.config only sets colors and overlay layers', () => {
    expect(config).toContain("colors: { primary: 'brand', neutral: 'slate' }")
    for (const key of ['button:', 'input:', 'inputNumber:', 'card:', 'table:', 'badge:', 'textarea:', 'calendar:', 'progress:']) {
      expect(config, key).not.toContain(key)
    }
    expect(config).not.toMatch(/rounded-|min-h-|nasq-ui-(?!z-)|nasq-elevation/)
  })

  it('tokens keep brand derivation, the Arabic font and modes, and drop custom geometry', () => {
    expect(tokens).toContain('--color-brand-500')
    expect(tokens).toContain('IBM Plex Sans Arabic')
    expect(tokens).toContain(':root.cream')
    expect(tokens).toContain('.dark')
    for (const token of ['--nasq-radius', '--ui-radius', '--elevation-1', '--content-shadow', '--radius:']) {
      expect(tokens, token).not.toContain(token)
    }
  })

  it('no component recipes remain in the shared stylesheets', () => {
    expect(comps).not.toMatch(/\.nasq-ui-|\.nasq-elevation-|data-nasq-reference-detail/)
    expect(shell).not.toContain('content-shadow')
  })
})
