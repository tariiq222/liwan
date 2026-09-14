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
const attachments = readFileSync(resolve(root, '../TaskAttachments.vue'), 'utf8')
const assignee = readFileSync(resolve(root, '../AssigneePicker.vue'), 'utf8')
const description = readFileSync(resolve(root, '../TaskDescription.vue'), 'utf8')
const timeline = readFileSync(resolve(root, '../Timeline.vue'), 'utf8')
const subtasks = readFileSync(resolve(root, '../SubtaskList.vue'), 'utf8')
const dependencies = readFileSync(resolve(root, '../DependencyPicker.vue'), 'utf8')
const composer = readFileSync(resolve(root, '../CommentComposer.vue'), 'utf8')

describe('task chrome design', () => {
  it('keeps task detail chrome in the context row and leaves the shell title to the page wrapper', () => {
    expect(panel).toContain('data-testid="task-detail-context"')
    expect(panel).not.toContain('SharedPageHeader')
    expect(panel).not.toContain('usePageHeader')
    expect(detailPage).toContain('width="detail"')
    expect(detailPage).toContain('SharedPageHeader')
    expect(detailPage).not.toContain('<h1')
    // Direction-aware icons follow SharedPageHeader: one RTL-drawn icon mirrored in LTR.
    expect(pageHeader).toContain('ltr:rotate-180')
    expect(panel).toContain('name="i-lucide-arrow-right" aria-hidden="true" class="size-4.5 ltr:rotate-180"')
    expect(panel).not.toMatch(/isRtl|localeProperties/)
  })

  it('puts task sections in UTabs instead of stacked cards', () => {
    expect(details).toContain('data-testid="task-detail-tabs"')
    expect(details).toContain(':unmount-on-hide="false"')
    expect(details).not.toContain('task-optional-details')
    expect(panel).not.toContain('task-detail-shell')
    expect(panel).not.toContain('TaskActivity')
  })

  it('uses the shared inline confirmation for archive and attachment deletion', () => {
    expect(panel).toMatch(/<SharedInlineConfirm[^>]*data-testid="task-archive-confirm"/)
    expect(panel).toContain('@confirm="doArchive"')
    expect(panel).not.toContain('bg-error/5')
    expect(attachments).toMatch(/role="group" :aria-label="t\('attachments\.deleteConfirm'\)">\s*<SharedInlineConfirm/)
    expect(attachments).toContain('@confirm="confirmDelete(attachment.id)"')
    expect(attachments).not.toContain('<style')
  })

  it('builds task pickers, rich text and row actions from the shared components', () => {
    expect(assignee).toContain('<SharedPersonPicker')
    expect(assignee).toContain('value-key="id"')
    expect(assignee).not.toContain('usePeople')
    expect(description).toContain('<SharedRichText')
    expect(description).toContain('richTextHasContent(readHtml.value)')
    expect(description).not.toContain('<style')
    expect(timeline).toContain('<SharedRichText')
    expect(archived).toContain('<SharedRowActions')
    for (const source of [panel, details, subtasks, dependencies, composer]) expect(source).not.toContain('<style')
    for (const source of [subtasks, dependencies, attachments]) expect(source).not.toMatch(/task-list|task-empty-inline/)
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
