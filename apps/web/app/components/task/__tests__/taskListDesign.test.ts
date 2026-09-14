import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = resolve(import.meta.dirname, '../../..')
const page = readFileSync(resolve(appRoot, 'pages/tasks.vue'), 'utf8')
const toolbar = readFileSync(resolve(appRoot, 'components/task/TaskToolbar.vue'), 'utf8')
const table = readFileSync(resolve(appRoot, 'components/task/TaskTable.vue'), 'utf8')
const board = readFileSync(resolve(appRoot, 'components/task/TaskBoard.vue'), 'utf8')

describe('tasks list design', () => {
  it('puts create and archive in the page header, filters in the toolbar', () => {
    expect(page).toContain('#actions')
    expect(page).toContain("can('pmo.tasks.create')")
    expect(page).toContain("t('tasks.new')")
    expect(page).toContain('/archived-tasks')
    expect(page).not.toContain('hide-create')
    expect(toolbar).not.toContain("can('pmo.tasks.create')")
    expect(toolbar).not.toContain("t('tasks.new')")
    expect(toolbar).not.toMatch(/SelectTrigger size="sm"/)
    expect(toolbar).not.toMatch(/<Button variant="outline" size="sm"/)
    expect(toolbar).toContain('bg-elevated/40')
    expect(toolbar).toContain("view === 'table' ? 'soft' : 'ghost'")
    expect(toolbar).toContain(":aria-pressed=\"view === 'table'\"")
    expect(toolbar).toContain('<SharedFilterChoice')
    expect(toolbar).toContain(':model-value="stateChoiceValue"')
    expect(toolbar).toContain("tasks.filters.allStates")
    expect(toolbar).toContain('for="task-filter-project"')
    expect(toolbar).not.toContain('UDropdownMenu')
  })

  it('wraps the standalone table in the shared rounded border surface', () => {
    expect(table).toContain("embedded ? '' : 'rounded-lg ring ring-default bg-default overflow-hidden'")
    expect(table).not.toContain('nasq-panel')
    expect(table).toContain(':loading="isFetchingNextPage"')
  })

  it('wraps the standalone board in the shared rounded border surface and keeps the embedded inner section', () => {
    expect(board).toContain("embedded ? 'space-y-2 p-4' : 'rounded-lg ring ring-default bg-default overflow-hidden space-y-2 p-4'")
    expect(board).not.toMatch(/p-\[18px\]|min-h-\[420px\]/)
    expect(board).not.toContain('nasq-panel')
    expect(page).not.toMatch(/stat-card|metrics-strip|nasq-metric/)
    expect(toolbar).not.toContain("t('tasks.table')")
  })
})
