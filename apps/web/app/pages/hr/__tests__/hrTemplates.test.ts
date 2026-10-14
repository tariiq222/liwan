import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The HR pages stay on their templates. This is a source guard, not a behaviour test: the behaviour is
// pinned by e2e/tasmim6-hr-*.spec.ts and by hrReturnChain.test.ts / meetingEmployeeReturnChain.test.ts.
const app = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the HR pages stay on their templates', () => {
  it.each([
    ['pages/hr/index.vue', ['<SharedListPage', 'create-test-id="hr-employee-new"']],
    ['pages/hr/departments/index.vue', ['<SharedListPage', 'create-test-id="hr-department-new"', ':views="views"']],
    ['pages/hr/documents.vue', ['<SharedListPage', 'create-test-id="hr-document-new"', '<SharedDataTable']],
    ['pages/hr/departments/[departmentId].vue', ['<SharedRecordPage', '<SharedRecordSection', '<SharedPropertiesPanel', ':hide-header="isCreateDocument"']],
    ['pages/hr/employees/[employeeId].vue', ['<SharedRecordPage', '<EmployeeProperties']],
    ['pages/hr/departments/[departmentId]/documents/[documentId].vue', ['<SharedRecordPage', '<SharedRecordSection']],
    ['components/hr/DirectoryTable.vue', ['<SharedDataTable', '#mobile-row', 'data-testid="hr-employee-name"']],
    ['components/hr/DepartmentTable.vue', ['<SharedDataTable', '#mobile-row']],
    ['components/hr/DocumentList.vue', ['<SharedDataTable', '#mobile-row']],
    ['components/hr/EmployeeCard.vue', ['<SharedRecordSection']],
    ['components/hr/EmployeeProperties.vue', ['<SharedPropertiesPanel', '<SharedPropertyRow']],
    ['pages/hr/employees/[employeeId]/edit.vue', ['<EmployeeGeneralForm', ' panel ']],
    ['pages/hr/departments/[departmentId]/edit.vue', ['<DepartmentForm', ' panel ']],
    ['pages/hr/departments/[departmentId]/documents/[documentId]/edit.vue', ['<SharedFormSection panel']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
  })

  it('draws no hand-made table or skeleton in the migrated HR files', () => {
    for (const file of ['pages/hr/index.vue', 'pages/hr/documents.vue', 'pages/hr/departments/index.vue', 'components/hr/DirectoryTable.vue', 'components/hr/DepartmentTable.vue', 'components/hr/DocumentList.vue', 'components/hr/EmployeeCard.vue']) {
      const source = read(file)
      expect(source, file).not.toMatch(/<UTable\b/)
      expect(source, file).not.toMatch(/<USkeleton\b/)
      expect(source, file).not.toMatch(/md:hidden/)
    }
  })

  it('has one DataTable per HR page', () => {
    const departmentRecord = read('pages/hr/departments/[departmentId].vue') + read('components/hr/DocumentList.vue')
    expect(departmentRecord.match(/<SharedDataTable\b/g)).toHaveLength(1)
  })

  it('keeps the create panels route-backed', () => {
    for (const file of ['pages/hr/employees/new.vue', 'pages/hr/departments/new.vue', 'pages/hr/documents/new.vue', 'pages/hr/departments/[departmentId]/documents/new.vue']) {
      expect(read(file), file).toContain('<SharedCreatePanel')
    }
  })
})
