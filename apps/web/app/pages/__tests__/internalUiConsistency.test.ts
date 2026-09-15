import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../')
const pagesRoot = resolve(webRoot, 'app/pages')
const componentsRoot = resolve(webRoot, 'app/components')

function walk(dir: string, suffix: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full, suffix)
    return full.endsWith(suffix) ? [full] : []
  })
}

const pageFiles = walk(pagesRoot, '.vue')
const businessComponentFiles = walk(componentsRoot, '.vue').filter(path => !path.includes('/components/ui/'))

describe('internal UI width and status vocabulary', () => {
  it('keeps page widths aligned with the approved Nuxt reference', () => {
    const css = readFileSync(resolve(webRoot, 'app/assets/css/shell.css'), 'utf8')
    expect(css).toContain('.nasq-page-width-list')
    expect(css).toContain('.nasq-page-width-detail')
    expect(css).toContain('.nasq-page-width-form')
    expect(css).toContain('.nasq-page-width-list { max-width: 100rem; }')
    expect(css).toContain('.nasq-page-width-detail { max-width: 68rem; }')
    expect(css).toContain('.nasq-page-width-form { max-width: 58rem; }')
  })

  it('defines theme-aware status tokens instead of a second palette', () => {
    const css = readFileSync(resolve(webRoot, 'app/assets/css/components.css'), 'utf8') + readFileSync(resolve(webRoot, 'app/assets/css/tokens.css'), 'utf8')
    expect(css).toContain('--status-success')
    expect(css).toContain('--status-warning')
    expect(css).toContain('.nasq-status-text-warning')
    expect(css).toContain('.nasq-unread-count')
    expect(css).toContain('--unread-count-foreground')
    expect(css).toContain('--status-info')
    expect(css).toContain('--status-danger')
    expect(css).toContain('--status-danger-foreground')
  })

  it('marks the flat workspace tab strip by data-active so cream and dark keep a visible current state', () => {
    // Task 4 collapsed the group/sub-tab pair into one flat row keyed by
    // activeProjectSection(); the old model.activeGroup/activeTab wiring is gone.
    const css = readFileSync(resolve(webRoot, 'app/assets/css/components.css'), 'utf8')
    const tabs = readFileSync(resolve(webRoot, 'app/components/project/workspace/ProjectWorkspaceTabs.vue'), 'utf8')
    expect(tabs).toContain(':data-active="current === section.id"')
    expect(tabs).toContain(':aria-current="current === section.id ? \'page\' : undefined"')
    // Stock Nuxt UI utilities: the active tab is marked by data-active and
    // aria-current, the strip scrolls horizontally and never wraps.
    const sectionTabs = readFileSync(resolve(webRoot, 'app/utils/sectionTabs.ts'), 'utf8')
    expect(tabs).toContain(':class="routeTabClass"')
    expect(sectionTabs).toContain('data-[active=true]:text-primary')
    expect(sectionTabs).toContain('overflow-x-auto border-b border-default')
    expect(sectionTabs).toContain('whitespace-nowrap')
    expect(css).not.toContain('.nasq-ui-tab')
  })

  it('opens every record as an ordinary page instead of a sliding side sheet', () => {
    // The route-backed sheet and the machinery that guessed what sat behind it
    // are deleted: a record's parent is now path arithmetic, not a return chain.
    const css = readFileSync(resolve(webRoot, 'app/assets/css/components.css'), 'utf8')
    const app = readFileSync(resolve(webRoot, 'app/app.vue'), 'utf8')
    expect(existsSync(resolve(webRoot, 'app/components/project/workspace/ProjectRouteHost.vue'))).toBe(false)
    expect(existsSync(resolve(webRoot, 'app/components/project/workspace/ProjectRouteModal.vue'))).toBe(false)
    expect(existsSync(resolve(webRoot, 'app/utils/projectOverlayRoute.ts'))).toBe(false)
    expect(app).toContain('<NuxtPage />')
    expect(app).not.toContain('ProjectRouteHost')
    for (const dead of ['nasq-sheet-in', 'nasq-sheet-out', 'project-overlay-enter', 'project-overlay-exit', 'project-sheet-backdrop', 'nasq-ui-route-sheet']) {
      expect(css, dead).not.toContain(dead)
    }
  })

  it('uses SharedPageContainer or settings/digest shells on internal pages', () => {
    const skipped = new Set([
      'index.vue',
      'login.vue',
      'reports.vue', // Legacy query-preserving redirect to /projects/dashboard.
      'hr/employees/[employeeId]/access.vue',
      'meetings.vue', // Nested parent: list or <NuxtPage /> by route.
      'projects.vue', // Nested parent: list or <NuxtPage /> by route.
      'project-templates.vue', // Nested parent: list or <NuxtPage /> by route.
      'hr.vue', // Thin parent: directory under /hr/employees/new then <NuxtPage />.
      'hr/departments.vue', // Thin parent: list under /hr/departments/new then <NuxtPage />.
      'settings/users.vue', // Thin parent: list under /settings/users/new then <NuxtPage />.
      'settings/roles.vue', // Thin parent: list under /settings/roles/new then <NuxtPage />.
      'settings/projects/catalogs/[resource].vue', // Thin parent: list under /new then <NuxtPage />.
    ])
    const missing = pageFiles.filter((file) => {
      const rel = relative(pagesRoot, file)
      if (rel.includes('/__tests__/') || skipped.has(rel)) return false
      const source = readFileSync(file, 'utf8')
      return !(
        source.includes('SharedPageContainer')
        || source.includes('SharedCreatePanel')
        || source.includes('SettingsLayout')
        || source.includes('nasq-page-width-form')
        || source.includes('ChatWorkspace')
        || source.includes('TaskDetailPage')
      )
    }).map(file => relative(pagesRoot, file))
    expect(missing).toEqual([])
  })

  it('does not leave ad-hoc page max-width utilities on business pages', () => {
    const offenders = pageFiles.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return /nasq-page-stack[^"\n]*(max-w-\[1440px\]|max-w-\[940px\]|max-w-2xl|max-w-3xl|max-w-4xl|max-w-5xl|max-w-7xl)/.test(source)
        || /class="[^"]*(max-w-5xl|max-w-7xl|max-w-4xl|max-w-3xl)[^"]*"/.test(source)
    }).map(file => relative(pagesRoot, file))
    expect(offenders).toEqual([])
  })

  it('replaces ad-hoc Tailwind status palettes in business components and pages', () => {
    const files = [...pageFiles, ...businessComponentFiles]
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return /(?:text|bg|border)-(?:emerald|amber|red|green|yellow)-\d+/.test(source)
    }).map(file => relative(webRoot, file))
    expect(offenders).toEqual([])
  })
})
