import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Architecture guard: the layer keeps recipes in the shared sheets, never in a component style block.
const app = resolve(import.meta.dirname, '../../..')
describe('layer component styles live in shared sheets', () => {
  it.each(['shared/layout/SettingsPage.vue', 'shared/form/RichText.vue'])('%s has no private style block', path => {
    expect(readFileSync(resolve(app, 'components', path), 'utf8')).not.toMatch(/<style(?:\s|>)/)
  })
})

describe('mock identity utilities', () => {
  const css = readFileSync(resolve(app, 'assets/css/components.css'), 'utf8')

  it('marks section titles with the Sadu diamond (9x13, ink at 40%, 50% in dark) and the triangle flips in RTL', () => {
    expect(css).toMatch(/\.liwan-sadu-diamond-mark::before \{[^}]*height: 13px;[^}]*sadu-diamond\.svg/)
    expect(css).toMatch(/\.liwan-sadu-triangle-mark::before \{[^}]*height: 11px;[^}]*scaleX\(-1\)[^}]*sadu-triangle\.svg/)
    expect(css).toMatch(/width: 9px;\s*margin-inline-end: 9px;[^}]*opacity: 0\.4;/)
    expect(css).toMatch(/\.dark \.liwan-sadu-diamond-mark::before,\s*\.dark \.liwan-sadu-triangle-mark::before \{ opacity: 0\.5; \}/)
    expect(css).toContain('.liwan-sadu-triangle-mark:dir(ltr)::before { transform: none; }')
  })

  it('points both marks at shipped brand assets', () => {
    for (const name of ['sadu-diamond.svg', 'sadu-triangle.svg']) expect(() => readFileSync(resolve(app, 'assets/brand/sadu', name))).not.toThrow()
  })

  it('draws the 64px tile at 18px radius, and lifts an interactive card 2px', () => {
    expect(css).toMatch(/\.liwan-app-tile\.liwan-app-tile-lg \{\s*width: 64px;\s*height: 64px;\s*border-radius: var\(--radius-card\);/)
    expect(css).toMatch(/\.liwan-lift:hover \{\s*transform: translateY\(-2px\);\s*box-shadow: 0 16px 30px -18px rgb\(20 16 42 \/ 24%\);/)
  })

  it('has one 1.5px card surface with a dark top highlight', () => {
    expect(css).toContain('.liwan-card { border: 1.5px solid var(--ui-border); background: var(--ui-bg); }')
    expect(css).toContain('.dark .liwan-card { box-shadow: inset 0 1px 0 rgb(255 255 255 / 4%); }')
  })
})
