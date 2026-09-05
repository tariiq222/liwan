import { describe, expect, it } from 'vitest'
import { hrDepartmentKeys } from '../useHrDepartments'
import { hrEmployeeKeys } from '../useHrEmployees'
import { hrDocumentKeys } from '../useHrDocuments'

describe('hr query keys', () => {
  it('departments list is [hr, departments]', () => {
    expect(hrDepartmentKeys.list).toEqual(['hr', 'departments'])
  })

  it('employees list includes params', () => {
    const params = { q: 'سارة', department_id: 4 }
    expect(hrEmployeeKeys.list(params)).toEqual(['hr', 'employees', params])
  })

  it('employee detail is [hr, employee, id]', () => {
    expect(hrEmployeeKeys.detail(10)).toEqual(['hr', 'employee', 10])
  })

  it('documents list includes params', () => {
    const params = { q: 'لائحة', department_id: 4 }
    expect(hrDocumentKeys.list(params)).toEqual(['hr', 'documents', params])
  })

  it('document detail is [hr, document, id]', () => {
    expect(hrDocumentKeys.detail(21)).toEqual(['hr', 'document', 21])
  })
})
