import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guard for the top bar's one icon-button style (owner-approved reorganisation): every tool is the same tile as the sidebar core-apps row
// with no background at rest and a light fill on hover; groups are separated by a hairline, never a tinted capsule.
const css = resolve(import.meta.dirname, '..')
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '')
const shell = strip(readFileSync(resolve(css, 'shell.css'), 'utf8'))
const rule = (selector: string) => shell.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]"=():-]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

describe('top bar icon buttons', () => {
  it('are the same 36px tile as the sidebar core-apps row: surface, hairline, ink icon, solid ink while open', () => {
    const tool = rule('.liwan-tool')
    expect(tool).toMatch(/width: var\(--liwan-bar-tile\);/)
    expect(tool).toMatch(/border: 1px solid var\(--ui-border\);/)
    expect(tool).toMatch(/background: var\(--ui-bg\);/)
    expect(tool).toMatch(/color: var\(--liwan-ink\);/)
    expect(shell).toContain('.liwan-tool[data-open="true"] { border-color: var(--liwan-ink); background: var(--liwan-ink); color: var(--liwan-on-ink); }')
    expect(shell).toContain('.liwan-tool:focus-visible { outline: 2px solid var(--ring);')
  })

  it('have no tinted capsule around a group and no bordered stand-alone variant', () => {
    expect(rule('.liwan-tools')).not.toMatch(/background|box-shadow|padding/)
    expect(shell).not.toContain('data-variant="outline"')
    expect(shell).not.toContain('.liwan-app-grid')
    expect(shell).not.toContain('.liwan-app-switcher')
  })

  it('have no divider between the groups', () => {
    expect(shell).not.toContain('liwan-shell-divider')
  })
})

describe('top bar user button', () => {
  it('is a bordered surface tile of the same height that fills on hover and while its menu is open', () => {
    const user = rule('.liwan-user')
    expect(user).toMatch(/height: var\(--liwan-bar-tile\);/)
    expect(user).toMatch(/border: 1px solid var\(--ui-border\);/)
    expect(user).toMatch(/background: var\(--ui-bg\);/)
    expect(shell).toContain('.liwan-user:hover, .liwan-user[data-state="open"] { background: var(--ui-bg-muted); }')
  })

  it('keeps the avatar alone below 1100px', () => {
    expect(shell).toMatch(/@media \(max-width: 1099px\) \{[^@]*\.liwan-user :is\(\[data-slot="copy"\], \[data-slot="chevron"\]\) \{ display: none; \}/)
  })
})
