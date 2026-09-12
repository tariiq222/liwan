import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const layout = readFileSync(resolve(root, 'layouts/default.vue'), 'utf8')
const nuxtConfig = readFileSync(resolve(root, '../nuxt.config.ts'), 'utf8')
const shellCss = readFileSync(resolve(root, 'assets/css/shell.css'), 'utf8')
const componentsCss = readFileSync(resolve(root, 'assets/css/components.css'), 'utf8')
const navModel = readFileSync(resolve(root, 'composables/useNav.ts'), 'utf8')
const projectSectionsModel = readFileSync(resolve(root, 'composables/nav/projectSections.ts'), 'utf8')
const accountMenu = readFileSync(resolve(root, 'components/AppAccountMenu.vue'), 'utf8')
const contextSidebar = readFileSync(resolve(root, 'components/shell/ContextSidebar.vue'), 'utf8')
const moduleRail = readFileSync(resolve(root, 'components/shell/ModuleRail.vue'), 'utf8')
const mobileNavigation = readFileSync(resolve(root, 'components/shell/MobileNavigation.vue'), 'utf8')
const globalSearch = readFileSync(resolve(root, 'components/GlobalSearch.vue'), 'utf8')
const notificationCenter = readFileSync(resolve(root, 'components/notifications/NotificationCenter.vue'), 'utf8')
const chatWorkspace = readFileSync(resolve(root, 'components/chat/ChatWorkspace.vue'), 'utf8')
const shellNavigation = readFileSync(resolve(root, 'composables/useShellNavigation.ts'), 'utf8')
const arCommon = readFileSync(resolve(root, '../i18n/locales/ar/common.json'), 'utf8')
const enCommon = readFileSync(resolve(root, '../i18n/locales/en/common.json'), 'utf8')

describe('approved shell structure', () => {
  it('uses one explicit shell frame without SidebarProvider', () => {
    expect(layout).toContain('data-nasq-shell')
    expect(layout).toContain('ShellHeader')
    expect(layout).not.toContain('ShellBreadcrumb')
    expect(layout).not.toContain('SidebarProvider')
    expect(shellCss).toContain('--module-rail-width: 76px')
    expect(shellCss).toContain('--context-sidebar-width: 236px')
    expect(layout).not.toContain('nuxt-shell.css')
  })

  it('keeps context navigation in the desktop sidebar and reserves mobile for the slideover', () => {
    expect(shellCss).toContain('.nasq-context-sidebar {')
    expect(shellCss).toContain('.nasq-context-links { display: grid;')
    expect(componentsCss).toContain('.nasq-context-create')
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
  })

  it('renders no breadcrumb anywhere in the shell', () => {
    // DESIGN.md §3 forbids a breadcrumb in the layout; the context heading and
    // the workspace tabs carry the context it used to duplicate.
    for (const source of [layout, contextSidebar, mobileNavigation, shellNavigation, shellCss, arCommon, enCommon]) {
      expect(source).not.toMatch(/breadcrumb/i)
    }
  })

  it('uses the branded shell token for both header and rail', () => {
    expect(shellCss).toContain('background: var(--nasq-surface)')
    expect(shellCss).toContain('background: var(--nasq-rail)')
    expect(shellCss).toContain('.nasq-module-rail')
    expect(shellCss).toContain('.nasq-shell-header')
  })

  it('keeps the reference shell frame square and the active rail item branded', () => {
    expect(shellCss).toContain('border-radius: 0;')
    expect(shellCss).toContain('border-inline-start: 1px solid var(--border)')
    expect(shellCss).toContain('background: color-mix(in srgb, var(--nasq-rail) 72%, var(--primary))')
    expect(shellCss).toContain('color: #fff;')
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
  it('uses local UIcon names for shared navigation icons', () => {
    const directIconImport = ['@', 'lucide/vue'].join('')
    for (const source of [navModel, accountMenu, contextSidebar, moduleRail, mobileNavigation]) {
      expect(source).not.toContain(directIconImport)
    }
    for (const source of [contextSidebar, moduleRail, mobileNavigation]) expect(source).toContain('<UIcon')
    // NavIcon's declaration now lives in nav/projectSections.ts (its one auto-import
    // owner); useNav.ts imports the type rather than redeclaring it.
    expect(projectSectionsModel).toContain('export type NavIcon = `i-lucide-${string}`')
    expect(componentsCss).toContain('.nasq-shell-icon')
    expect(shellCss).toContain('[data-slot="label"]')
    expect(globalSearch).toContain('data-slot="label" class="nasq-search-trigger-label')
    expect(shellCss).toContain('.nasq-search-trigger-label')
    expect(shellCss).not.toContain('.nasq-search-trigger > span > span')
    expect(shellCss).not.toContain('.nasq-context-link > span')
    expect(shellCss).not.toContain('.nasq-module-rail-link span')
  })

  it('scans app TypeScript so shared dynamic UIcon names are bundled offline', () => {
    expect(nuxtConfig).toContain("provider: 'none'")
    expect(nuxtConfig).toContain("fallbackToApi: false")
    expect(nuxtConfig).toContain("'app/composables/**/*.ts'")
    expect(nuxtConfig).toContain("'**/*.{vue,jsx,tsx,md,mdc,mdx,yml,yaml}'")
  })

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
    expect(shellCss).toContain('@media (max-width: 767px)')
    expect(shellCss).toContain('.nasq-module-rail,')
    expect(shellCss).toContain('.nasq-context-sidebar { display: none !important; }')
    expect(shellCss).toContain('display: none !important')
    expect(componentsCss).toContain('.nasq-mobile-menu-trigger { display: none; }')
    expect(shellCss).toMatch(/\.nasq-mobile-menu-trigger \{ display: inline-flex;/)
    expect(componentsCss).toContain('min-height: 44px')
    expect(shellCss).toContain('var(--brand-soft)')
    expect(shellCss).toContain('inset-inline-start: 0')
    expect(componentsCss.includes('var(--secondary)')).toBe(false)
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

function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...vueFiles(path))
    else if (entry.name.endsWith('.vue')) out.push(path)
  }
  return out
}

describe('button ranks', () => {
  it('does not use filled secondary for chrome actions', () => {
    const skip = new Set([resolve(root, 'components/settings/BrandingPreview.vue')])
    const tag = /<UButton\b[^>]*>/gs
    const filled: string[] = []
    for (const file of vueFiles(root)) {
      if (skip.has(file)) continue
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(tag)) {
        const open = match[0]
        if (!/color=["']secondary["']/.test(open)) continue
        if (/variant=["'](?:outline|ghost|soft|subtle|link)["']/.test(open)) continue
        filled.push(`${file.slice(root.length + 1)}: ${open.replace(/\s+/g, ' ').slice(0, 120)}`)
      }
    }
    expect(filled).toEqual([])
  })
})
