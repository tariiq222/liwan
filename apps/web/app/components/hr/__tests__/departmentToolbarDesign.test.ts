import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../pages/hr/departments/index.vue'),
  'utf8',
)

describe('department list toolbar design', () => {
  it('unifies the list toolbar with FilterBar and the shared segmented view switch', () => {
    expect(source).toContain("import FilterBar from '@/components/shared/FilterBar.vue'")
    expect(source).toContain(':active-count="activeFilterCount"')
    expect(source).not.toMatch(/nasq-toolbar nasq-panel/)
    expect(source).toContain('role="group"')
    expect(source).toContain('rounded-md p-0.5 ring ring-default')
    expect(source).not.toContain('h-[40px]')
    expect(source).toContain('square')
    expect(source).toContain('data-testid="hr-departments-view-list"')
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
    expect(source).toContain('<UAlert v-if="deleting" role="alert" color="error"')
    expect(source).toContain("path: '/hr/departments/new'")
  })
})
