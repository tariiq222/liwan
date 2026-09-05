import {
  HrAccessGrantSchema,
  HrAccessPatchSchema,
  HrAccessRoleSchema,
  HrDepartmentSchema,
  HrDepartmentCreateSchema,
  HrDepartmentPatchSchema,
  HrDocumentAttachmentSchema,
  HrDocumentDetailSchema,
  HrDocumentSchema,
  HrEmployeeAccessSchema,
  HrEmployeeCreateSchema,
  HrEmployeePatchSchema,
  HrEmployeeSchema,
  HrEmployeeListSchema,
  HrRefSchema,
  HrWritableRoleSchema,
} from '..'

const DEPARTMENT = {
  id: 4,
  name: 'الهندسة',
  parent_id: 1,
  manager: { id: 9, name: 'Sara' },
  child_ids: [5, 6],
  employee_count: 3,
}

const EMPLOYEE = {
  id: 10,
  name: 'Sara',
  job_title: 'مهندسة',
  department: { id: 4, name: 'الهندسة' },
  work_email: 'sara@example.com',
  work_phone: '+9665',
  user_id: 7,
  manager: { id: 11, name: 'Huda' },
  active: true,
  access: { user_id: 7, login: 'sara', role: 'employee', active: true },
}

const ATTACHMENT = {
  id: 3,
  name: 'policy.pdf',
  mimetype: 'application/pdf',
  file_size: 2048,
}

const DOCUMENT = {
  id: 21,
  name: 'لائحة الإجازات',
  department: { id: 4, name: 'الهندسة' },
  body: '<p>body</p>',
  attachment_ids: [ATTACHMENT],
  write_date: '2026-09-04T10:00:00Z',
}

describe('HrDepartmentSchema', () => {
  it('accepts a valid department dump', () => {
    const parsed = HrDepartmentSchema.parse(DEPARTMENT)
    expect(parsed.child_ids).toEqual([5, 6])
  })

  it('accepts null parent_id and manager', () => {
    const parsed = HrDepartmentSchema.parse({
      ...DEPARTMENT,
      parent_id: null,
      manager: null,
      child_ids: [],
    })
    expect(parsed.parent_id).toBeNull()
    expect(parsed.manager).toBeNull()
  })

  it('rejects extra keys', () => {
    expect(() => HrDepartmentSchema.parse({ ...DEPARTMENT, extra: true })).toThrow()
  })
})

describe('HrEmployeeSchema', () => {
  it('accepts a valid employee dump with distinct employee id and user_id', () => {
    const parsed = HrEmployeeSchema.parse(EMPLOYEE)
    expect(parsed.id).toBe(10)
    expect(parsed.user_id).toBe(7)
    expect(parsed.id).not.toBe(parsed.user_id)
  })

  it('accepts an empty job_title and null department/user_id', () => {
    const parsed = HrEmployeeSchema.parse({
      ...EMPLOYEE,
      job_title: '',
      department: null,
      work_email: '',
      work_phone: '',
      user_id: null,
    })
    expect(parsed.job_title).toBe('')
    expect(parsed.user_id).toBeNull()
  })

  it('rejects extra keys', () => {
    expect(() => HrEmployeeSchema.parse({ ...EMPLOYEE, extra: true })).toThrow()
  })
})

describe('Phase 3b HR input and compatibility schemas', () => {
  it('accepts the complete compatibility block and preserves the employee list envelope', () => {
    expect(HrRefSchema.parse({ id: 4, name: 'الهندسة' })).toEqual({ id: 4, name: 'الهندسة' })
    expect(HrAccessRoleSchema.parse('vendor')).toBe('vendor')
    expect(HrWritableRoleSchema.parse('admin')).toBe('admin')
    expect(HrEmployeeAccessSchema.parse(EMPLOYEE.access)).toEqual(EMPLOYEE.access)
    expect(HrEmployeeSchema.parse(EMPLOYEE).access?.login).toBe('sara')
    expect(HrEmployeeListSchema.parse({ items: [EMPLOYEE], total: 1 }).items[0]?.work_phone).toBe('+9665')
    expect(HrDepartmentSchema.parse(DEPARTMENT).employee_count).toBe(3)
  })

  it('rejects top-level employee arrays, extra keys, and vendor write roles', () => {
    expect(() => HrEmployeeListSchema.parse([EMPLOYEE])).toThrow()
    expect(() => HrEmployeeSchema.parse({ ...EMPLOYEE, extra: true })).toThrow()
    expect(() => HrAccessGrantSchema.parse({ password: '12345678', role: 'vendor' })).toThrow()
    expect(() => HrAccessPatchSchema.parse({})).toThrow()
  })

  it('accepts strict employee and department writes with nullable relations', () => {
    expect(HrEmployeeCreateSchema.parse({ name: '  Sara  ', department_id: null, parent_id: null }).name).toBe('Sara')
    expect(HrEmployeePatchSchema.parse({ department_id: null, parent_id: null })).toEqual({ department_id: null, parent_id: null })
    expect(HrAccessGrantSchema.parse({ password: '12345678', role: 'employee' }).role).toBe('employee')
    expect(HrAccessPatchSchema.parse({ password: '12345678' }).password).toBe('12345678')
    expect(HrDepartmentCreateSchema.parse({ name: '  Finance ', parent_id: null, manager_id: 9 }).name).toBe('Finance')
    expect(HrDepartmentCreateSchema.parse({ name: 'Finance', manager_id: null }).manager_id).toBeNull()
    expect(HrDepartmentPatchSchema.parse({ parent_id: null, manager_id: 9 })).toEqual({ parent_id: null, manager_id: 9 })
    expect(HrDepartmentPatchSchema.parse({ manager_id: null })).toEqual({ manager_id: null })
  })

  it('rejects blank names, short effective passwords, and extra write keys', () => {
    expect(() => HrEmployeeCreateSchema.parse({ name: '   ' })).toThrow()
    expect(() => HrDepartmentCreateSchema.parse({ name: '' })).toThrow()
    expect(() => HrAccessGrantSchema.parse({ password: '  1234567  ', role: 'employee' })).toThrow()
    expect(() => HrAccessPatchSchema.parse({ role: 'admin', extra: true })).toThrow()
    expect(() => HrEmployeePatchSchema.parse({ extra: true })).toThrow()
    expect(() => HrDepartmentCreateSchema.parse({ name: 'Finance', manager_id: 0 })).toThrow()
    expect(() => HrDepartmentPatchSchema.parse({ manager_id: '9' })).toThrow()
    expect(() => HrDepartmentPatchSchema.parse({ manager_id: 9, extra: true })).toThrow()
  })
})

describe('HrDocumentAttachmentSchema', () => {
  it('accepts a valid attachment dump', () => {
    const parsed = HrDocumentAttachmentSchema.parse(ATTACHMENT)
    expect(parsed.file_size).toBe(2048)
  })

  it('rejects extra keys', () => {
    expect(() => HrDocumentAttachmentSchema.parse({ ...ATTACHMENT, extra: true })).toThrow()
  })
})

describe('HrDocumentSchema', () => {
  it('accepts a valid document dump', () => {
    const parsed = HrDocumentSchema.parse(DOCUMENT)
    expect(parsed.department).toEqual({ id: 4, name: 'الهندسة' })
    expect(parsed.attachment_ids).toHaveLength(1)
  })

  it('rejects tags', () => {
    expect(() => HrDocumentSchema.parse({ ...DOCUMENT, tags: [] })).toThrow()
  })

  it('rejects extra keys', () => {
    expect(() => HrDocumentSchema.parse({ ...DOCUMENT, extra: true })).toThrow()
  })
})

describe('HrDocumentDetailSchema', () => {
  it('accepts the same dump as HrDocumentSchema', () => {
    const parsed = HrDocumentDetailSchema.parse(DOCUMENT)
    expect(parsed.body).toBe('<p>body</p>')
  })

  it('rejects tags', () => {
    expect(() => HrDocumentDetailSchema.parse({ ...DOCUMENT, tags: ['policy'] })).toThrow()
  })
})
