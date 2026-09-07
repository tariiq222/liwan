import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../pages/hr/departments/index.vue'),
  'utf8',
)

describe('department list toolbar design', () => {
  it('unifies the list toolbar with FilterBar and a 40px/32px list-tree toggle', () => {
    expect(source).toContain("import FilterBar from '@/components/shared/FilterBar.vue'")
    expect(source).toContain('class="nasq-toolbar"')
    expect(source).not.toMatch(/nasq-toolbar nasq-panel/)
    expect(source).toContain('role="group"')
    expect(source).toContain('h-[40px]')
    expect(source).toContain('size-[32px]')
    expect(source).toContain("t('hr.depts.search')")
    expect(source).toContain("t('hr.depts.listView')")
    expect(source).toContain("t('hr.depts.hierarchy')")
    expect(source).toContain('aria-pressed')
    expect(source).toContain('setView(false)')
    expect(source).toContain('setView(true)')
    expect(source).toContain('<DepartmentTree')
    expect(source).toContain('<DepartmentTable')
    expect(source).toContain("can('hr.departments.manage')")
    expect(source).toContain('askDelete')
    expect(source).toContain('nasq-status-callout-danger')
    expect(source).toContain("path: '/hr/departments/new'")
  })
})
