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
    expect(toolbar).toContain('bg-muted/40')
    expect(toolbar).toContain("view === 'table' ? 'bg-background shadow-sm'")
    expect(toolbar).toContain('stateFilterLabel')
    expect(toolbar).toContain("tasks.filters.selectedStates")
  })

  it('wraps the standalone table in nasq-panel', () => {
    expect(table).toContain("embedded ? '' : 'nasq-panel overflow-hidden'")
    expect(table).not.toContain('rounded-md border')
  })

  it('wraps the standalone board in nasq-panel and keeps the embedded inner section', () => {
    expect(board).toContain("embedded ? 'space-y-2 p-[18px]' : 'nasq-panel space-y-2 overflow-hidden p-[18px]'")
    expect(page).not.toMatch(/stat-card|metrics-strip|nasq-metric/)
    expect(toolbar).not.toContain("t('tasks.table')")
  })
})
