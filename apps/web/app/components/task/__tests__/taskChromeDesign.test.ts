import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = dirname(fileURLToPath(import.meta.url))
const panel = readFileSync(resolve(root, '../TaskDetailPanel.vue'), 'utf8')
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
    expect(panel).toContain('focus-visible:ring-2 focus-visible:ring-ring')
    expect(pageHeader).toContain('focus-visible:ring-2 focus-visible:ring-ring')
  })

  it('uses the shared danger callout for inline archive confirmation', () => {
    expect(panel).toContain('data-testid="task-archive-confirm"')
    expect(panel).toContain('nasq-status-callout-danger')
    expect(panel).not.toMatch(/task-archive-confirm[^>]*bg-destructive\/5/)
  })

  it('gives archived tasks shared header, toolbar, and state treatment without project-list chrome', () => {
    expect(archived).toContain('SharedPageHeader')
    expect(archived).toContain(':back-to="backTo"')
    expect(archived).toContain('nasq-toolbar')
    expect(archived).toContain('SharedPageState')
    expect(archived).toContain(':loading="isLoading && !items.length"')
    expect(archived).toContain(':error="items.length ? null : error"')
    expect(archived).toContain('<li v-for="task in items"')
    expect(archived).not.toContain('ProjectTable')
    expect(archived).not.toContain('ProjectCards')
    expect(archived).not.toContain('FilterBar')
  })
})
