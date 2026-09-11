import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const layout = readFileSync(resolve(root, 'layouts/default.vue'), 'utf8')
const shellCss = readFileSync(resolve(root, 'assets/css/approved-shell.css'), 'utf8')
const nuxtShellCss = readFileSync(resolve(root, 'assets/css/nuxt-shell.css'), 'utf8')
const accountMenu = readFileSync(resolve(root, 'components/AppAccountMenu.vue'), 'utf8')
const contextSidebar = readFileSync(resolve(root, 'components/shell/ContextSidebar.vue'), 'utf8')
const moduleRail = readFileSync(resolve(root, 'components/shell/ModuleRail.vue'), 'utf8')
const mobileNavigation = readFileSync(resolve(root, 'components/shell/MobileNavigation.vue'), 'utf8')
const globalSearch = readFileSync(resolve(root, 'components/GlobalSearch.vue'), 'utf8')
const notificationCenter = readFileSync(resolve(root, 'components/notifications/NotificationCenter.vue'), 'utf8')
const chatWorkspace = readFileSync(resolve(root, 'components/chat/ChatWorkspace.vue'), 'utf8')

describe('approved shell structure', () => {
  it('uses one explicit shell frame without SidebarProvider', () => {
    expect(layout).toContain('data-nasq-shell')
    expect(layout).toContain('ShellHeader')
    expect(layout).not.toContain('ShellBreadcrumb')
    expect(layout).not.toContain('SidebarProvider')
    expect(shellCss).toContain('--module-rail-width: 64px')
    expect(shellCss).toContain('--context-sidebar-width: 244px')
    expect(layout).toContain('nuxt-shell.css')
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
    expect(chatWorkspace).toContain("useMediaQuery('(min-width: 768px)'")
    expect(chatWorkspace).not.toContain('lg:grid-cols-[20rem_minmax(0,1fr)]')
  })

  it('derives sidebar and mobile groups from one shared useNav function', () => {
    for (const source of [contextSidebar, mobileNavigation]) {
      expect(source).toContain('shellContextGroups(')
      expect(source).toContain('contextModuleFor(')
      expect(source).not.toContain('contextGroupsForModule')
      expect(source).not.toContain('nav.projectWork')
      expect(source).not.toContain('nav.projectsOverview')
      expect(source).not.toContain('nav.currentProject')
    }
    expect(contextSidebar).toContain('breadcrumbLinks')
  })

  it('uses the branded shell token for both header and rail', () => {
    expect(shellCss).toContain('background: var(--shell-background)')
    expect(shellCss).toContain('.nasq-module-rail')
    expect(shellCss).toContain('.nasq-shell-header')
  })

  it('keeps the account menu above the shell and out of the header flow', () => {
    expect(accountMenu).toContain('z-[80]')
    expect(accountMenu).toContain(':modal="false"')
    expect(accountMenu).toContain('avoidCollisions: false')
    expect(accountMenu).toContain("updatePositionStrategy: 'always'")
    expect(accountMenu).not.toContain('DropdownMenuItem as-child')
    expect(shellCss).toContain('.approved-account-menu { z-index: 80; }')
    expect(shellCss).toContain('html[dir="rtl"] body { padding-right: 0 !important; }')
  })
})

describe('Nuxt UI shell migration', () => {
  it('uses Nuxt UI primitives for rail, context, search, notifications and account', () => {
    expect(moduleRail).toContain('<UButton')
    expect(moduleRail).toContain('<UTooltip')
    expect(moduleRail).toContain('visibleShellModules')
    expect(moduleRail).toContain('useModuleRail')
    expect(contextSidebar).toContain('<UButton')
    expect(contextSidebar).toContain('useShellNavigation')
    expect(globalSearch).toContain('<UModal')
    expect(globalSearch).toContain('<UInput')
    expect(globalSearch).not.toMatch(/from ['"][^'"]+ui\/dialog['"]/)
    expect(notificationCenter).toContain('<UPopover')
    expect(notificationCenter).toContain("to=\"/notifications\"")
    expect(notificationCenter).toContain('items.slice(0, 5)')
    expect(accountMenu).toContain('<UDropdownMenu')
    expect(accountMenu).toContain('<UAvatar')
    expect(accountMenu).toContain("navigateTo('/login')")
  })

  it('hides desktop rail and context under 768px and uses a real mobile slideover', () => {
    expect(nuxtShellCss).toContain('@media (max-width: 767px)')
    expect(nuxtShellCss).toContain('[data-nasq-shell] .nasq-module-rail')
    expect(nuxtShellCss).toContain('[data-nasq-shell] .nasq-context-sidebar')
    expect(nuxtShellCss).toContain('display: none !important')
    expect(nuxtShellCss).toContain('.nasq-mobile-menu-trigger { display: none; }')
    expect(nuxtShellCss).toMatch(/\[data-nasq-shell\] \.nasq-mobile-menu-trigger \{[^}]*display: inline-flex;/)
    expect(nuxtShellCss).toContain('min-height: 44px')
    expect(nuxtShellCss).toContain('var(--nasq-brand-secondary)')
    expect(nuxtShellCss).toContain('inset-inline-start: 0')
    expect(nuxtShellCss.includes('var(--secondary)')).toBe(false)
    expect(mobileNavigation).toContain('<USlideover')
    expect(mobileNavigation).toContain("useMediaQuery('(min-width: 768px)'")
    expect(mobileNavigation).toContain('visibleShellModules')
    expect(mobileNavigation).toContain('useShellNavigation')
    expect(mobileNavigation).toContain('route.fullPath')
    expect(mobileNavigation).toContain('if (value) open.value = false')
    expect(mobileNavigation).toContain('nav.openMenu')
    expect(mobileNavigation).toContain('nav.navigation')
    expect(mobileNavigation).not.toContain('usePreview')
    expect(mobileNavigation).not.toContain('previewModules')
  })
})
