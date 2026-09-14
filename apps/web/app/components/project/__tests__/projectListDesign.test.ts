import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = resolve(import.meta.dirname, '../../..')
const page = readFileSync(resolve(appRoot, 'pages/projects/index.vue'), 'utf8')
const table = readFileSync(resolve(appRoot, 'components/project/ProjectTable.vue'), 'utf8')

describe('projects list design', () => {
  it('table rows reveal their menu on hover/focus and keep numbers tabular', () => {
    expect(table).toContain('nasq-ui-row-actions')
    expect(table).toContain('ProjectStatusBadge')
    expect(table).toMatch(/date_end-cell[\s\S]*?nasq-ui-num/)
  })

  it('page is header → toolbar → one record surface holding the list and its pager', () => {
    const header = page.indexOf('<SharedPageHeader')
    const toolbar = page.indexOf('data-testid="projects-toolbar"')
    const surface = page.indexOf('data-testid="projects-list-surface"')
    const pager = page.indexOf('data-testid="projects-pager"')
    expect(header).toBeGreaterThanOrEqual(0)
    expect(toolbar).toBeGreaterThan(header)
    expect(surface).toBeGreaterThan(toolbar)
    expect(pager).toBeGreaterThan(surface)
    expect(page).not.toMatch(/fixed\s+bottom/)
  })

  it('shows the result count inside the toolbar, not as a loose paragraph', () => {
    const count = page.indexOf('data-testid="projects-result-count"')
    const toolbarEnd = page.indexOf('</FilterBar>')
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(toolbarEnd)
  })
})
