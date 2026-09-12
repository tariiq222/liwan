import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Source-text assertions: this repo has no DOM/component-mount harness.
const pagePath = resolve(import.meta.dirname, '../projects/[id]/milestones/index.vue')
const source = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : ''
const table = readFileSync(resolve(import.meta.dirname, '../../components/project/MilestoneTable.vue'), 'utf8')

describe('project milestones section page', () => {
  it('exists so /projects/:id/milestones resolves inside the frame', () => {
    expect(existsSync(pagePath)).toBe(true)
  })

  it('wraps itself in the shared page band', () => {
    expect(source).toContain('SharedPageContainer')
  })

  it('renders the milestone table with the project it owns', () => {
    const tag = source.match(/<MilestoneTable\b[^>]*>/s)?.[0]
    expect(tag).toBeDefined()
    expect(tag).toContain(':project-id="project.id"')
    expect(tag).toContain(':can-manage="project.can_manage"')
  })

  it('gives the milestone table a stable root hook', () => {
    // The section page is now the only route that renders it, so the table
    // needs its own handle independent of the page around it.
    expect(table.match(/<template>\s*\n\s*<[^>]*>/)?.[0]).toContain('data-testid="milestone-table"')
  })

  it('offers create only to a manager of an active project', () => {
    const canCreate = source.match(/const canCreate = computed\([\s\S]*?\n/)?.[0]
    expect(canCreate).toBeDefined()
    expect(canCreate).toContain('can_manage')
    expect(canCreate).toContain('active')
    // The create action is a gated row, as on the summary page.
    const row = source.match(/<div v-if="canCreate"[\s\S]*?<\/div>/)?.[0]
    expect(row).toBeDefined()
    expect(row).toContain('data-testid="project-header-create"')
    expect(row).toContain(':disabled="!hydrated"')
  })

  it('leaves the only h1 to the frame and registers the shell title itself', () => {
    expect(source).not.toContain('<h1')
    expect(source).not.toContain('SharedPageHeader')
    expect(source).toContain("usePageHeader(() => t('projects.tabs.milestones'))")
  })

  it('uses logical spacing only', () => {
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr)-\d/)
    expect(source).not.toMatch(/\b(?:left|right)-\d/)
  })
})
