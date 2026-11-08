import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guard for the top bar's one icon-button style (owner-approved reorganisation): every tool is the same tile as the sidebar core-apps row
// with no background at rest and a light fill on hover; the tools share one soft capsule (the mock's top-bar treatment).
const css = resolve(import.meta.dirname, '..')
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '')
const shell = strip(readFileSync(resolve(css, 'shell.css'), 'utf8'))
const rule = (selector: string) => shell.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]"=():-]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

describe('top bar icon buttons', () => {
  it('sit in one soft capsule: no border or fill at rest, ink icon, solid ink while their panel is open', () => {
    const tool = rule('.liwan-tool')
    expect(tool).toMatch(/border: 0;/)
    expect(tool).toMatch(/background: transparent;/)
    expect(tool).toMatch(/color: var\(--liwan-ink\);/)
    expect(shell).toContain('.liwan-tool[data-open="true"] { background: var(--liwan-ink); color: var(--liwan-on-ink); }')
    expect(shell).toContain('.liwan-tool:focus-visible { outline: 2px solid var(--ring);')
  })

  it('share one soft filled capsule with the same height as the other bar controls', () => {
    const tools = rule('.liwan-tools')
    expect(tools).toMatch(/height: var\(--liwan-bar-tile\);/)
    expect(tools).toMatch(/background: var\(--ui-bg-muted\);/)
    expect(tools).toMatch(/border: 1px solid var\(--ui-border\);/)
    expect(shell).not.toContain('data-variant="outline"')
    expect(shell).not.toContain('.liwan-app-grid')
    expect(shell).not.toContain('.liwan-app-switcher')
  })

  it('have no divider between the groups', () => {
    expect(shell).not.toContain('liwan-shell-divider')
  })
})

describe('top bar corner radius', () => {
  it('is one token shared by the capsule, the AI tile, the search field and the user chip', () => {
    for (const selector of ['.liwan-tools', '.liwan-user', '.liwan-ai-button']) expect(rule(selector), selector).toMatch(/border-radius: var\(--liwan-bar-radius\);/)
    expect(shell).toMatch(/\.liwan-shell-header \.liwan-search-trigger \{[^}]*border-radius: var\(--liwan-bar-radius\);/)
  })

  it('has the same corner shape on all four: none of them is a squircle', () => {
    const components = strip(readFileSync(resolve(css, 'components.css'), 'utf8'))
    const squircle = components.match(/@supports \(corner-shape: squircle\) \{([\s\S]*?)\{ corner-shape: squircle; \}/)?.[1] ?? ''
    for (const selector of ['.liwan-tools', '.liwan-ai-button', '.liwan-user', '.liwan-shell-header .liwan-search-trigger,', '.liwan-shell-header .liwan-search-trigger\n']) expect(squircle, selector).not.toContain(selector)
    expect(squircle).not.toMatch(/\.liwan-user(?![\w-])/)
    expect(squircle).not.toMatch(/\.liwan-ai-button/)
  })
})

describe('top bar user button', () => {
  it('is the same soft filled capsule as the tools, the same height, darker on hover and while its menu is open', () => {
    const user = rule('.liwan-user')
    expect(user).toMatch(/height: var\(--liwan-bar-tile\);/)
    expect(user).toMatch(/border: 1px solid var\(--ui-border\);/)
    expect(user).toMatch(/background: var\(--ui-bg-muted\);/)
    expect(shell).toContain('.liwan-user:hover, .liwan-user[data-state="open"] { background: color-mix(in srgb, var(--liwan-ink) 9%, var(--ui-bg-muted)); }')
  })

  it('keeps the avatar alone below 1100px', () => {
    expect(shell).toMatch(/@media \(max-width: 1099px\) \{[^@]*\.liwan-user :is\(\[data-slot="copy"\], \[data-slot="chevron"\]\) \{ display: none; \}/)
  })
})
