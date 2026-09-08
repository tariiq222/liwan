import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const layout = readFileSync(resolve(root, 'layouts/default.vue'), 'utf8')
const shellCss = readFileSync(resolve(root, 'assets/css/approved-shell.css'), 'utf8')
const accountMenu = readFileSync(resolve(root, 'components/AppAccountMenu.vue'), 'utf8')
const contextSidebar = readFileSync(resolve(root, 'components/shell/ContextSidebar.vue'), 'utf8')
const chatWorkspace = readFileSync(resolve(root, 'components/chat/ChatWorkspace.vue'), 'utf8')

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

  it('owns the desktop chat list in the context sidebar', () => {
    expect(contextSidebar).toContain("import ConversationList from '@/components/chat/ConversationList.vue'")
    expect(contextSidebar).toContain('v-if="isChat && isDesktop"')
    expect(contextSidebar).toContain(':data-chat="isChat"')
    expect(chatWorkspace).toContain("useMediaQuery('(min-width: 761px)'")
    expect(chatWorkspace).not.toContain('lg:grid-cols-[20rem_minmax(0,1fr)]')
  })

  it('uses the branded shell token for both header and rail', () => {
    expect(shellCss).toContain('background: var(--shell-background)')
    expect(shellCss).toContain('.nasq-module-rail')
    expect(shellCss).toContain('.nasq-shell-header')
  })

  it('keeps the account menu above the shell and out of the header flow', () => {
    expect(accountMenu).toContain('z-[80]')
    expect(accountMenu).toContain(':modal="false"')
    expect(accountMenu).toContain(':avoid-collisions="false"')
    expect(accountMenu).toContain('update-position-strategy="always"')
    expect(accountMenu).not.toContain('DropdownMenuItem as-child')
    expect(shellCss).toContain('.approved-account-menu { z-index: 80; }')
    expect(shellCss).toContain('html[dir="rtl"] body { padding-right: 0 !important; }')
  })
})
