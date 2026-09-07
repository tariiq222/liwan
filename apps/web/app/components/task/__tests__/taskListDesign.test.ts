import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = resolve(import.meta.dirname, '../../..')
const page = readFileSync(resolve(appRoot, 'pages/tasks.vue'), 'utf8')
const toolbar = readFileSync(resolve(appRoot, 'components/task/TaskToolbar.vue'), 'utf8')
const table = readFileSync(resolve(appRoot, 'components/task/TaskTable.vue'), 'utf8')

describe('tasks list design', () => {
  it('puts create and archive in the toolbar, not the page header', () => {
    expect(page).toContain('<SharedPageHeader :title="t(\'tasks.title\')" :description="t(\'tasks.description\')" />')
    expect(page).not.toContain('hide-create')
    expect(page).toContain('#trailing')
    expect(page).toContain('/archived-tasks')
    expect(toolbar).toContain('slot name="trailing"')
    expect(toolbar).toContain("can('pmo.tasks.create')")
    expect(toolbar).not.toMatch(/SelectTrigger size="sm"/)
    expect(toolbar).not.toMatch(/<Button variant="outline" size="sm"/)
    expect(toolbar).toContain('bg-muted/40')
    expect(toolbar).toContain("view === 'table' ? 'bg-background shadow-sm'")
  })

  it('wraps the standalone table in nasq-panel', () => {
    expect(table).toContain("embedded ? '' : 'nasq-panel overflow-hidden'")
    expect(table).not.toContain('rounded-md border')
  })
})
