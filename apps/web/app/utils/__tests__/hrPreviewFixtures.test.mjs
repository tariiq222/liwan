import { describe, expect, it } from 'vitest'
import { hrPreviewData } from '../../../e2e/hr-ui-preview-data.mjs'
import { capabilitiesForRequest } from '../../../e2e/mock-capabilities.mjs'
import { moduleUiPreviewData } from '../../../e2e/module-ui-preview-data.mjs'
import { HrDepartmentListSchema, HrDepartmentSchema, HrEmployeeListSchema, HrEmployeeSchema, HrExpiringListSchema, HrLeaveListSchema, HrLeaveSchema, HrSaudizationSchema } from '@liwan/contracts'

const at = (path, query = '') => new URL(`http://localhost${path}${query}`)
const names = (list) => list.items.map(item => item.name)

describe('the HR preview fixtures', () => {
  it('serve schema-valid lists and details through the module preview', () => {
    for (const [path, schema] of [
      ['/api/v1/hr/employees', HrEmployeeListSchema], ['/api/v1/hr/employees/3', HrEmployeeSchema],
      ['/api/v1/hr/departments', HrDepartmentListSchema], ['/api/v1/hr/departments/3', HrDepartmentSchema],
    ]) expect(() => schema.parse(moduleUiPreviewData(path, at(path))), path).not.toThrow()
  })

  it('serve schema-valid reports and leave requests', () => {
    for (const [path, schema] of [
      ['/api/v1/hr/saudization', HrSaudizationSchema], ['/api/v1/hr/expiring', HrExpiringListSchema],
      ['/api/v1/hr/leave/requests', HrLeaveListSchema], ['/api/v1/hr/leave/requests/1', HrLeaveSchema],
    ]) expect(() => schema.parse(moduleUiPreviewData(path, at(path))), path).not.toThrow()
  })

  it('serves own profile and own leave details without exposing another employee in the mock', () => {
    expect(hrPreviewData('/api/v1/hr/me', at('/api/v1/hr/me'))).toMatchObject({ id: 1, access: null, contract: null })
    expect(hrPreviewData('/api/v1/hr/leave/me/1', at('/api/v1/hr/leave/me/1'))).toMatchObject({ id: 1, employee: { id: 1 } })
    expect(hrPreviewData('/api/v1/hr/leave/me/2', at('/api/v1/hr/leave/me/2'))).toBeUndefined()
    const mine = hrPreviewData('/api/v1/hr/leave/requests', at('/api/v1/hr/leave/requests', '?mine=1'))
    expect(mine.items.map(item => item.id)).toEqual([1, 3])
    const pending = hrPreviewData('/api/v1/hr/leave/requests', at('/api/v1/hr/leave/requests', '?state=confirm,validate1'))
    expect(pending.items.map(item => item.id)).toEqual([1])
  })

  it('narrow the expiring items to the asked window, overdue ones included', () => {
    const list = (days) => hrPreviewData('/api/v1/hr/expiring', at('/api/v1/hr/expiring', `?within_days=${days}`))
    expect(list(30).items.map(item => item.days_left)).toEqual([-3, 5, 12, 25])
    expect(list(90).total).toBe(6)
  })

  it('keep row 1 of each list exactly as the single-row preview served it', () => {
    expect(hrPreviewData('/api/v1/hr/employees/1', at('/api/v1/hr/employees/1'))).toMatchObject({ id: 1, name: 'سارة محمد', job_title: 'مديرة العمليات', work_email: 'sara@example.test' })
    expect(hrPreviewData('/api/v1/hr/departments/1', at('/api/v1/hr/departments/1'))).toMatchObject({ id: 1, name: 'إدارة العمليات', employee_count: 4 })
  })

  it('filter employees by search, department and the archived scope', () => {
    const list = (query) => hrPreviewData('/api/v1/hr/employees', at('/api/v1/hr/employees', query))
    expect(names(list(''))).toEqual(['سارة محمد', 'خالد الشمري', 'منى القحطاني'])
    expect(names(list('?q=خالد'))).toEqual(['خالد الشمري'])
    expect(names(list('?department_id=2'))).toEqual(['خالد الشمري'])
    expect(names(list('?archived=true'))).toEqual(['ليلى الدوسري'])
    expect(list('?q=لا-يوجد')).toMatchObject({ items: [], total: 0 })
  })

  it('give the record with missing data no job, department, email, phone, manager or access', () => {
    expect(hrPreviewData('/api/v1/hr/employees/3', at('/api/v1/hr/employees/3'))).toMatchObject({ job_title: '', department: null, work_email: '', work_phone: '', manager: null, access: null })
  })

  it('answer undefined for an unknown id or a non-HR path', () => {
    expect(hrPreviewData('/api/v1/hr/employees/999', at('/api/v1/hr/employees/999'))).toBeUndefined()
    expect(hrPreviewData('/api/v1/meetings', at('/api/v1/meetings'))).toBeUndefined()
  })
})

describe('capabilitiesForRequest', () => {
  const all = ['hr.employees.read', 'hr.employees.manage', 'hr.employees.archive', 'documents.items.manage', 'access.users.grant', 'hr.departments.read']
  it('returns every capability without the reader cookie', () => {
    expect(capabilitiesForRequest(undefined, all)).toEqual(all)
    expect(capabilitiesForRequest('session_id=x', all)).toEqual(all)
  })
  it('drops manage, archive and grant capabilities for the reader cookie', () => {
    expect(capabilitiesForRequest('session_id=x; mock_caps=reader', all)).toEqual(['hr.employees.read', 'hr.departments.read'])
  })
})
