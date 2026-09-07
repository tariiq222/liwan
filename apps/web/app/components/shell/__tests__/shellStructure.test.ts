import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const layout = readFileSync(resolve(root, 'layouts/default.vue'), 'utf8')
const shellCss = readFileSync(resolve(root, 'assets/css/approved-shell.css'), 'utf8')

describe('approved shell structure', () => {
  it('uses one explicit shell frame without SidebarProvider', () => {
    expect(layout).toContain('data-nasq-shell')
    expect(layout).toContain('ShellHeader')
    expect(layout).not.toContain('SidebarProvider')
    expect(shellCss).toContain('--module-rail-width: 64px')
    expect(shellCss).toContain('--context-sidebar-width: 244px')
  })

  it('keeps context navigation visible and reflows it on mobile', () => {
    expect(shellCss).toContain('.nasq-context-sidebar {')
    expect(shellCss).toContain('.nasq-context-links { display: flex; overflow-x: auto;')
    expect(shellCss).toContain('.nasq-context-create')
    expect(shellCss).not.toContain('.nasq-context-sidebar[aria-collapsed]')
  })

  it('uses the branded shell token for both header and rail', () => {
    expect(shellCss).toContain('background: var(--shell-background)')
    expect(shellCss).toContain('.nasq-module-rail')
    expect(shellCss).toContain('.nasq-shell-header')
  })
})
