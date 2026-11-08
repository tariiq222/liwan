import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guard for the top bar's one icon-button style (owner-approved reorganisation): every tool is the same 40px button
// with no background at rest and a light fill on hover; groups are separated by a hairline, never a tinted capsule.
const css = resolve(import.meta.dirname, '..')
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '')
const shell = strip(readFileSync(resolve(css, 'shell.css'), 'utf8'))
const rule = (selector: string) => shell.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]"=():-]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

describe('top bar icon buttons', () => {
  it('are 40px, transparent at rest and filled with the muted background on hover or while open', () => {
    const tool = rule('.liwan-tool')
    expect(tool).toMatch(/width: 40px;/)
    expect(tool).toMatch(/height: 40px;/)
    expect(tool).toMatch(/background: transparent;/)
    expect(tool).toMatch(/border: 0;/)
    expect(tool).toMatch(/border-radius: var\(--radius-control\);/)
    expect(shell).toContain('.liwan-tool:hover, .liwan-tool[data-open="true"] { background: var(--ui-bg-muted);')
    expect(shell).toContain('.liwan-tool:focus-visible { outline: 2px solid var(--ring);')
  })

  it('have no tinted capsule around a group and no bordered stand-alone variant', () => {
    expect(rule('.liwan-tools')).not.toMatch(/background|box-shadow|padding/)
    expect(shell).not.toContain('data-variant="outline"')
    expect(shell).not.toContain('.liwan-app-grid')
    expect(shell).not.toContain('.liwan-app-switcher')
  })

  it('separate the groups with a one-pixel divider that phones drop', () => {
    expect(rule('.liwan-shell-divider')).toMatch(/width: 1px;[\s\S]*background: var\(--ui-border\);/)
    expect(shell).toMatch(/@media \(max-width: 767px\) \{[^@]*\.liwan-shell-divider \{ display: none; \}/)
  })
})

describe('top bar user button', () => {
  it('is a transparent 40px button that fills on hover and while its menu is open', () => {
    const user = rule('.liwan-user')
    expect(user).toMatch(/height: 40px;/)
    expect(user).toMatch(/background: transparent;/)
    expect(shell).toContain('.liwan-user:hover, .liwan-user[data-state="open"] { background: var(--ui-bg-muted); }')
  })

  it('keeps the avatar alone below 1100px', () => {
    expect(shell).toMatch(/@media \(max-width: 1099px\) \{[^@]*\.liwan-user :is\(\[data-slot="copy"\], \[data-slot="chevron"\]\) \{ display: none; \}/)
  })
})
