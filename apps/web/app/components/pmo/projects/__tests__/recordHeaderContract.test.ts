import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('project record header and list contracts', () => {
  it('draws back, title, status and a labelled settings action on one identity row', () => {
    const frame = read('pages/projects/[id].vue')
    const row = frame.slice(frame.indexOf('data-testid="project-workspace-identity"'), frame.indexOf('<ProjectWorkspaceTabs'))
    expect(row).toContain('data-testid="project-workspace-back"')
    expect(row).toContain('data-testid="project-workspace-name"')
    expect(row).toContain('data-testid="project-status"')
    expect(row).toMatch(/data-testid="project-workspace-settings"/)
    expect(row).toContain(":aria-label=\"t('nav.projectSettings')\"")
    expect(row).not.toContain(":label=\"t('nav.projectSettings')\"")
    // The old layout put the back control in its own row above the title.
    expect(frame).not.toContain('<div v-if="backTo" class="flex items-center gap-2 text-sm">')
  })

  it('treats ?view=list as the table view', () => {
    const page = read('pages/projects/index.vue')
    expect(page).toContain("view !== 'list'")
    expect(page).toContain("view: 'table'")
  })

  it('uses UCollapsible, not native details, for optional charter sections', () => {
    const display = read('components/pmo/projects/ProjectCharterDisplay.vue')
    expect(display).toContain('<UCollapsible')
    expect(display).not.toContain('<details')
  })

  it('does not repeat the charter sub-tab name as a heading', () => {
    expect(read('pages/projects/[id]/charter.vue')).toMatch(/<SharedPageHeader class="nasq-print-hide" hide-title/)
  })

  it('gives every project row an action control', () => {
    const menu = read('components/pmo/projects/ProjectMenu.vue')
    expect(menu).toContain('<SharedRowActions')
    expect(read('components/pmo/projects/ProjectCardBody.vue')).toContain(':to="toFor(project)"')
    expect(read('components/pmo/projects/ProjectTable.vue')).toContain(':to="toFor(row.original)"')
  })

  it('labels every template column and leads with the number', () => {
    const page = read('pages/projects/templates/index.vue')
    expect(page.indexOf("id: 'number'")).toBeLessThan(page.indexOf("id: 'name'"))
    expect(page).not.toContain("class: 'sr-only'")
    expect(page).toContain("id: 'actions'")
  })
})
