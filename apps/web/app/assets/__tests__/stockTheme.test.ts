import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Components render with Nuxt UI v4's recipes plus one documented polish layer
// that lives in app.config.ts only (DESIGN.md «وصفات الثيم المعتمدة»). The
// theme inputs are the brand primary from settings, the neutral palette, the
// official `--ui-radius` token, the Arabic font and the display modes.
const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), 'utf8')
const config = read('../../app.config.ts')
const tokens = read('../css/tokens.css')
const comps = read('../css/components.css')
const shell = read('../css/shell.css')

const ALLOWED_RECIPE_KEYS = [
  'colors', 'button', 'input', 'inputNumber', 'textarea', 'select', 'selectMenu', 'card', 'table', 'badge', 'tabs',
  'progress', 'avatar', 'dropdownMenu', 'popover', 'tooltip', 'slideover', 'modal', 'checkbox', 'switch', 'formField',
]

describe('theme layer', () => {
  it('app.config sets colors and only the documented recipe keys', () => {
    expect(config).toContain("colors: { primary: 'brand', neutral: 'slate' }")
    const keys = [...config.matchAll(/^\s{4}([a-zA-Z]+):/gm)].map(m => m[1]!)
    for (const key of keys) expect(ALLOWED_RECIPE_KEYS, key).toContain(key)
    expect(config).not.toMatch(/nasq-ui-(?!z-)|nasq-elevation|nasq-[a-z]+-surface/)
  })

  it('tokens keep brand derivation, the Arabic font and modes, and only the official radius token', () => {
    expect(tokens).toContain('--color-brand-500')
    expect(tokens).toContain('IBM Plex Sans Arabic')
    expect(tokens).toContain(':root.cream')
    expect(tokens).toContain('.dark')
    expect(tokens).toMatch(/--ui-radius: 0\.5rem/)
    for (const token of ['--nasq-radius', '--elevation-1', '--content-shadow', '--radius:']) {
      expect(tokens, token).not.toContain(token)
    }
  })

  it('no component recipes remain in the shared stylesheets', () => {
    expect(comps).not.toMatch(/\.nasq-ui-|\.nasq-elevation-|data-nasq-reference-detail/)
    expect(shell).not.toContain('content-shadow')
  })
})
