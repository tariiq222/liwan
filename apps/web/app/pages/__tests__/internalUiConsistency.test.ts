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
  it('keeps CSS page widths at list/detail 1440 and form 940', () => {
    const css = readFileSync(resolve(webRoot, 'app/assets/css/approved-shell.css'), 'utf8')
    expect(css).toContain('.nasq-page-width-list')
    expect(css).toContain('.nasq-page-width-detail')
    expect(css).toContain('.nasq-page-width-form')
    expect(css).toContain('max-width: 1440px')
    expect(css).toContain('.nasq-page-width-form { width: 100%; max-width: 940px;')
    expect(css).toContain('.nasq-form-section-title')
  })

  it('defines theme-aware status tokens instead of a second palette', () => {
    const css = readFileSync(resolve(webRoot, 'app/assets/css/main.css'), 'utf8')
    expect(css).toContain('--status-success')
    expect(css).toContain('--status-warning')
    expect(css).toContain('.nasq-status-chip-success')
    expect(css).toContain('.nasq-status-chip-warning')
    expect(css).toContain('.nasq-unread-count')
    expect(css).toContain('--unread-count-foreground')
    expect(css).toContain('--status-danger-foreground')
  })

  it('uses SharedPageContainer or settings/digest shells on internal pages', () => {
    const skipped = new Set([
      'index.vue',
      'login.vue',
      'settings/branding.vue',
      'hr/employees/[employeeId]/access.vue',
      'reports.vue',
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
