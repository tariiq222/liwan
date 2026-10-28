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
    ['pages/hr/departments/index.vue', ['<SharedListPage', 'create-test-id="hr-department-new"', ':views="views"', 'views-in-filters', '<SharedListCard', '<SharedListFooter', 'embedded']],
    ['components/hr/LeaveList.vue', ['<SharedListPage', 'create-test-id="hr-leave-new"', '<SharedListCard', '<SharedDataTable', ' bare', '#mobile-row', '<SharedListFooter', '<SharedSegmentedControl', '<HrLeaveDecisionConfirm', '<SharedRowActions', '<SharedMetricTile']],
    ['pages/hr/reports.vue', ['<SharedListPage', '<SharedForbiddenState', '<SharedListCard', '<SharedMetricTile', '<SharedProgress', '<SharedDataTable', ' bare', '#mobile-row', '<SharedSegmentedControl', '<SharedListFooter']],
    ['components/hr/LeaveRecord.vue', ['<SharedRecordPage', '<SharedIdentityCard', '<SharedPropertiesPanel', '<SharedPropertyRow', '#aside', '<HrLeaveDecisionConfirm']],
    ['components/hr/LeaveDecisionConfirm.vue', ['<SharedInlineConfirm', '<UTextarea']],
    ['components/hr/LeaveRequestForm.vue', ['<SharedFormSection panel', '<SharedFormActions', '<SharedUnsavedChanges', '<SharedDateField']],
    ['components/hr/LeaveAllocationForm.vue', ['<SharedFormSection panel', '<SharedFormActions', '<SharedUnsavedChanges']],
    ['pages/hr/leave/allocations/index.vue', ['<SharedListPage', '<SharedListCard', '<SharedDataTable', ' bare', '#mobile-row', '<SharedListFooter']],
    ['pages/hr/leave/allocations/[allocationId].vue', ['<SharedRecordPage', '<SharedIdentityCard', '<SharedPropertiesPanel', '#aside', '<LeaveAllocationForm']],
    ['pages/hr/shifts/assignments/[assignmentId].vue', ['<SharedRecordPage', '<SharedIdentityCard', '<SharedPropertiesPanel', '#aside', '<ShiftAssignmentForm']],
    ['pages/hr/onboarding/new.vue', ['<SharedCreatePanel', '<SharedUnsavedChanges :dirty="dirty"']],
    ['components/hr/lifecycle/DepartureForm.vue', ['<SharedUnsavedChanges :dirty="dirty"', '<SharedFormSection panel']],
    ['components/hr/lifecycle/RunCancel.vue', ['<SharedInlineConfirm', '<UTextarea', 'color="error"']],
    ['pages/hr/departments/[departmentId].vue', ['<SharedRecordPage', '<SharedIdentityCard', '<SharedRecordSection', '<SharedPropertiesPanel', '#aside']],
    ['pages/hr/employees/[employeeId].vue', ['<SharedRecordPage', '<EmployeeProperties', '#aside', '<SharedRowActions']],
    ['components/hr/DirectoryTable.vue', ['<SharedListCard', '<SharedListFooter', '<SharedDataTable', ' bare', '#mobile-row', 'data-testid="hr-employee-name"']],
    ['components/hr/DepartmentTable.vue', ['<SharedDataTable', ' bare', '#mobile-row']],
    ['components/hr/EmployeeCard.vue', ['<SharedIdentityCard', 'variant="tinted"']],
    ['components/hr/EmployeeProperties.vue', ['<SharedPropertiesPanel', '<SharedPropertyRow']],
    ['pages/hr/employees/[employeeId]/edit.vue', ['<EmployeeGeneralForm', ':back-to="backTo"']],
    ['pages/hr/departments/[departmentId]/edit.vue', ['<DepartmentForm', ':back-to="backTo"']],
    ['components/hr/EmployeeGeneralForm.vue', ['<SharedFormSection panel', '<SharedFormActions']],
    ['components/hr/DepartmentForm.vue', ['<SharedFormSection panel', '<SharedFormActions']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
  })

  it.each(['onboarding', 'offboarding', 'recruitment', 'shifts', 'assets'])('pages/hr/%s.vue draws its list only on the list route and keeps the child routes', (area) => {
    const source = read(`pages/hr/${area}.vue`)
    expect(source).toContain('v-if="isListRoute"')
    expect(source).toContain('<NuxtPage')
  })

  it('draws no hand-made table or skeleton in the migrated HR files', () => {
    for (const file of ['pages/hr/index.vue', 'pages/hr/departments/index.vue', 'components/hr/DirectoryTable.vue', 'components/hr/DepartmentTable.vue', 'components/hr/EmployeeCard.vue', 'pages/hr/leave.vue', 'pages/hr/reports.vue']) {
      const source = read(file)
      expect(source, file).not.toMatch(/<UTable\b/)
      expect(source, file).not.toMatch(/<USkeleton\b/)
      expect(source, file).not.toMatch(/md:hidden/)
    }
  })

  it('keeps hand-made radii, fixed heights and form spacing overrides out of the HR records and forms', () => {
    for (const file of ['components/hr/DepartmentTree.vue', 'components/hr/DepartmentOrgChart.vue', 'components/hr/EmployeeCard.vue', 'components/hr/EmployeeGeneralForm.vue', 'components/hr/DepartmentForm.vue']) {
      const source = read(file)
      expect(source, file).not.toMatch(/rounded-(md|lg|xl|\[)/)
      expect(source, file).not.toMatch(/h-\[calc|min-h-\[|min-w-52/)
      expect(source, file).not.toMatch(/<SharedFormSection[^>]*(mt-4|space-y-)/)
      expect(source, file).not.toMatch(/webvue-form-grid mt-4/)
    }
  })

  it('has one DataTable per HR page', () => {
    const departmentRecord = read('pages/hr/departments/[departmentId].vue')
    expect(departmentRecord.match(/<SharedDataTable\b/g)).toBeNull()
  })

  it('keeps the create panels route-backed', () => {
    for (const file of ['pages/hr/employees/new.vue', 'pages/hr/departments/new.vue', 'pages/hr/self/leave/new.vue', 'pages/hr/leave/allocations/new.vue']) {
      expect(read(file), file).toContain('<SharedCreatePanel')
    }
  })
})
