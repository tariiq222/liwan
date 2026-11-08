import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const read = (file: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', file), 'utf8')
const toolbar = read('TaskToolbar.vue')
const table = read('TaskTable.vue')

describe('TaskToolbar', () => {
  it('keeps every attribute filter inside one popover with a count badge and a polite live count', () => {
    expect(toolbar).toContain('<UPopover')
    expect(toolbar).toContain('modal')
    for (const id of ['task-filter-state', 'task-filter-priority', 'task-filter-assignee', 'task-filter-deadline', 'task-filter-project']) expect(toolbar).toContain(id)
    expect(toolbar).toContain('task-filters-count')
    expect(toolbar).toMatch(/role="status" aria-live="polite"/)
    expect(toolbar).not.toContain('<USelect\n        multiple')
  })

  it('draws chips under the row only while a filter is set, and never one for the search text', () => {
    expect(toolbar).toContain('v-if="filterable && chips.length"')
    expect(toolbar).toContain('taskFilterChips(props.modelValue')
  })

  it('offers archived only when the host controls the scope, and keeps just search and scope there', () => {
    expect(toolbar).toContain("...(props.scope ? [{ value: 'archived'")
    expect(toolbar).toContain("emit('update:scope'")
    expect(toolbar).toContain('const filterable = computed(() => !timeline.value && !archived.value)')
    expect(toolbar).toContain('v-if="listView && !archived"')
  })

  it('swaps the search, filters and scope for the timeline controls in the timeline view', () => {
    expect(toolbar).toContain('<slot name="timeline" />')
    expect(toolbar).toContain("view.value === 'timeline'")
  })

  it('shows the columns menu in the table view only, as checkbox items that keep the menu open', () => {
    expect(toolbar).toContain('const showColumns = computed(() => filterable.value && (view.value === undefined || view.value === \'table\'))')
    expect(toolbar).toContain("type: 'checkbox'")
    expect(toolbar).toContain('event.preventDefault()')
  })

  it('draws the view switch of the page as icons and no longer uses the old filter bar', () => {
    expect(toolbar).toContain('icon-only')
    expect(toolbar).toContain('LIST_VIEW_KEY')
    expect(toolbar).not.toContain('FilterBar')
  })
})

describe('TaskTable columns', () => {
  it('reads the visible columns from the shared column preference and drops the old fixed minimum width', () => {
    expect(table).toContain('useTaskColumns(props.variant)')
    expect(table).not.toContain('minWidthClass')
    expect(table).not.toContain('deadlineTagView')
  })

  it('shows the assignee as avatar and name, and the deadline as a plain date', () => {
    expect(table).toContain('data-testid="task-assignee"')
    expect(table).toContain('deadlineCellView')
    expect(table).not.toContain('tasks.deadline.inDays')
  })
})
