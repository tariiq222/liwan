import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = dirname(fileURLToPath(import.meta.url))
const panel = readFileSync(resolve(root, '../TaskDetailPanel.vue'), 'utf8')
const details = readFileSync(resolve(root, '../TaskDetails.vue'), 'utf8')
const detailPage = readFileSync(resolve(root, '../TaskDetailPage.vue'), 'utf8')
const archived = readFileSync(resolve(root, '../../../pages/archived-tasks.vue'), 'utf8')
const pageHeader = readFileSync(resolve(root, '../../shared/PageHeader.vue'), 'utf8')

describe('task chrome design', () => {
  it('keeps task detail chrome in the context row and leaves the shell title to the page wrapper', () => {
    expect(panel).toContain('data-testid="task-detail-context"')
    expect(panel).not.toContain('SharedPageHeader')
    expect(panel).not.toContain('usePageHeader')
    expect(detailPage).toContain('width="detail"')
    expect(detailPage).toContain('SharedPageHeader')
    expect(detailPage).not.toContain('<h1')
    expect(panel).toContain('focus-visible:ring-2 focus-visible:ring-primary')
    expect(pageHeader).toContain('focus-visible:ring-2 focus-visible:ring-ring')
  })

  it('is a two-column record with the properties aside and no scoped css', () => {
    const properties = readFileSync(resolve(root, '../TaskProperties.vue'), 'utf8')
    const shell = readFileSync(resolve(root, '../../../assets/css/shell.css'), 'utf8')
    expect(panel).toContain('data-testid="task-detail-grid" class="nasq-record-grid"')
    expect(panel).toMatch(/<details class="nasq-record-aside"[\s\S]*?<summary class="nasq-record-aside-summary"[\s\S]*?<TaskProperties/)
    expect(shell).toMatch(/@media \(max-width: 1023px\)[\s\S]*?details\.nasq-record-aside \{[^}]*order: -1/)
    expect(panel).not.toContain('<style')
    expect(details).not.toContain('<style')
    expect(properties).toContain('<dl class="nasq-record-props"')
    for (const control of ['StateMenu', 'AssigneePicker', 'PrioritySelect', 'MilestoneSelect', 'TagPicker']) expect(properties).toContain(`<${control}`)
    expect(details).not.toContain('AssigneePicker')
    expect(shell).toMatch(/\.nasq-record-grid \{/)
  })

  it('puts task sections in UTabs instead of stacked cards', () => {
    expect(details).toContain('data-testid="task-detail-tabs"')
    expect(details).toContain(':unmount-on-hide="false"')
    expect(details).not.toContain('task-optional-details')
    expect(panel).not.toContain('task-detail-shell')
    expect(panel).not.toContain('TaskActivity')
  })

  it('uses the shared danger treatment for inline archive confirmation', () => {
    expect(panel).toContain('data-testid="task-archive-confirm"')
    expect(panel).toContain('border border-error/30 bg-error/5')
    expect(panel).not.toMatch(/task-archive-confirm[^>]*nasq-status-callout-danger/)
  })

  it('gives archived tasks shared header, toolbar, and state treatment without project-list chrome', () => {
    expect(archived).toContain('SharedPageHeader')
    expect(archived).toContain(':back-to="backTo"')
    expect(archived).toContain(':active-count="activeFilterCount"')
    expect(archived).toContain('SharedPageState')
    expect(archived).toContain(':loading="isLoading && !items.length"')
    expect(archived).toContain(':error="items.length ? null : error"')
    expect(archived).toContain('<li v-for="task in items"')
    expect(archived).not.toContain('ProjectTable')
    expect(archived).not.toContain('ProjectCards')
    expect(archived).toContain('<FilterBar')
    expect(archived).toContain('@clear="clearFilters"')
  })
})
