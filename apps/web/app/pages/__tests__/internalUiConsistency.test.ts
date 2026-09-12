import { readdirSync, readFileSync, statSync } from 'node:fs'
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
    const css = readFileSync(resolve(webRoot, 'app/assets/css/approved-shell.css'), 'utf8')
    expect(css).toContain('.nasq-page-width-list')
    expect(css).toContain('.nasq-page-width-detail')
    expect(css).toContain('.nasq-page-width-form')
    expect(css).toContain('.nasq-page-width-list { max-width: 100rem; }')
    expect(css).toContain('.nasq-page-width-detail { max-width: 68rem; }')
    expect(css).toContain('.nasq-page-width-form { max-width: 58rem; }')
  })

  it('defines theme-aware status tokens instead of a second palette', () => {
    const css = readFileSync(resolve(webRoot, 'app/assets/css/main.css'), 'utf8')
    expect(css).toContain('--status-success')
    expect(css).toContain('--status-warning')
    expect(css).toContain('.nasq-status-chip-success')
    expect(css).toContain('.nasq-status-chip-warning')
    expect(css).toContain('.nasq-unread-count')
    expect(css).toContain('--unread-count-foreground')
    expect(css).toContain('--status-info')
    expect(css).toContain('--status-danger')
    expect(css).toContain('--status-danger-foreground')
  })

  it('marks workspace group tabs by data-active so cream and dark keep a visible current state', () => {
    const css = readFileSync(resolve(webRoot, 'app/assets/css/nuxt-theme.css'), 'utf8')
    const tabs = readFileSync(resolve(webRoot, 'app/components/project/workspace/ProjectWorkspaceTabs.vue'), 'utf8')
    expect(tabs).toContain(':data-active="model.activeGroup === group.id"')
    expect(tabs).toContain('!group.links.length')
    expect(tabs).toContain(':aria-current="model.activeTab === link.id')
    expect(css).toContain(".nasq-ui-tab-strip .nasq-ui-tab[data-active='true']")
    expect(css).toContain('border-block-end: 1px solid var(--ui-border-accented)')
    expect(css).toContain('.nasq-ui-subtab-row [data-active=\'true\']')
    expect(css).toContain('min-height: 2.25rem')
    expect(css).toContain('scrollbar-width: none')
  })

  it('exits the project side sheet opposite the entry travel', () => {
    const css = readFileSync(resolve(webRoot, 'app/assets/css/nuxt-theme.css'), 'utf8')
    const host = readFileSync(resolve(webRoot, 'app/components/project/workspace/ProjectRouteHost.vue'), 'utf8')
    const modal = readFileSync(resolve(webRoot, 'app/components/project/workspace/ProjectRouteModal.vue'), 'utf8')
    expect(css).toContain('@keyframes nasq-sheet-in')
    expect(css).toContain('translateX(var(--project-overlay-enter, 100vw))')
    expect(css).toContain('translateX(var(--project-overlay-exit, -100vw))')
    expect(host).toContain("enter: rtl ? `-${availableWidth}px`")
    expect(host).toContain("exit: rtl ? `${availableWidth}px`")
    expect(host).toContain("side: rtl ? 'left' : 'right'")
    expect(modal).toContain("insetInlineEnd: '0'")
  })

  it('uses SharedPageContainer or settings/digest shells on internal pages', () => {
    const skipped = new Set([
      'index.vue',
      'login.vue',
      'reports.vue', // Legacy query-preserving redirect to /projects/dashboard.
      'hr/employees/[employeeId]/access.vue',
    ])
    const missing = pageFiles.filter((file) => {
      const rel = relative(pagesRoot, file)
      if (rel.includes('/__tests__/') || skipped.has(rel)) return false
      const source = readFileSync(file, 'utf8')
      return !(
        source.includes('SharedPageContainer')
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
