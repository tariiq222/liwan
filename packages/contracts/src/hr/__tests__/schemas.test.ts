import {
  HrAccessGrantSchema,
  HrAccessPatchSchema,
  HrAccessRoleSchema,
  HrDepartmentSchema,
  HrDepartmentCreateSchema,
  HrDepartmentListSchema,
  HrDepartmentPatchSchema,
  HrEmployeeAccessSchema,
  HrEmployeeContractPatchSchema,
  HrEmployeeContractSchema,
  HrExpiringListSchema,
  HrSaudizationSchema,
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
  contract: null,
}

const ATTACHMENT = {
  id: 3,
  name: 'policy.pdf',
  mimetype: 'application/pdf',
  file_size: 2048,
  url: '/api/v1/hr/documents/21/attachments/3/download',
}

const DOCUMENT = {
  id: 21,
  name: 'لائحة الإجازات',
  department: { id: 4, name: 'الهندسة' },
  body: '<p>body</p>',
  attachment_ids: [ATTACHMENT],
  expiry_date: '2026-12-31',
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

const CONTRACT = {
  type: { id: 1, name: 'Permanent' },
  start_date: '2026-01-01',
  end_date: null,
  probation_end_date: '2026-04-01',
  notice_period_days: 30,
  identity_expiry_date: '2028-05-05',
}

describe('HrEmployeeContractSchema', () => {
  it('accepts a contract block on the employee detail', () => {
    expect(HrEmployeeContractSchema.parse(CONTRACT).notice_period_days).toBe(30)
    expect(HrEmployeeSchema.parse({ ...EMPLOYEE, contract: CONTRACT }).contract?.start_date).toBe('2026-01-01')
  })

  it('accepts an empty contract and a null contract', () => {
    const empty = {
      type: null, start_date: null, end_date: null, probation_end_date: null,
      notice_period_days: 0, identity_expiry_date: null,
    }
    expect(HrEmployeeContractSchema.parse(empty)).toEqual(empty)
    expect(HrEmployeeSchema.parse(EMPLOYEE).contract).toBeNull()
  })

  it('rejects a missing contract key, bad dates, negative notice and extra keys', () => {
    const { contract: _contract, ...withoutContract } = EMPLOYEE
    expect(() => HrEmployeeSchema.parse(withoutContract)).toThrow()
    expect(() => HrEmployeeContractSchema.parse({ ...CONTRACT, end_date: '01/02/2027' })).toThrow()
    expect(() => HrEmployeeContractSchema.parse({ ...CONTRACT, notice_period_days: -1 })).toThrow()
    expect(() => HrEmployeeContractSchema.parse({ ...CONTRACT, salary: 1 })).toThrow()
  })
})

describe('HrEmployeeContractPatchSchema', () => {
  it('accepts partial contract writes, clearing with null, nested in the employee patch', () => {
    const patch = { start_date: '2026-01-01', end_date: null, contract_type_id: 3, notice_period_days: 30 }
    expect(HrEmployeeContractPatchSchema.parse(patch)).toEqual(patch)
    expect(HrEmployeePatchSchema.parse({ contract: { identity_expiry_date: null } }).contract).toEqual({ identity_expiry_date: null })
  })

  it('rejects empty, malformed, negative and money keys', () => {
    expect(() => HrEmployeeContractPatchSchema.parse({})).toThrow()
    expect(() => HrEmployeeContractPatchSchema.parse({ start_date: '01/02/2027' })).toThrow()
    expect(() => HrEmployeeContractPatchSchema.parse({ notice_period_days: -1 })).toThrow()
    expect(() => HrEmployeeContractPatchSchema.parse({ wage: 1 })).toThrow()
  })
})

describe('HrExpiringListSchema', () => {
  const ITEM = {
    kind: 'identity', employee: { id: 10, name: 'Sara' }, document: null,
    due_date: '2026-11-01', days_left: 14,
  }

  it('accepts employee and document items inside the list envelope', () => {
    const document = { ...ITEM, kind: 'document', employee: null, document: { id: 3, name: 'Licence' } }
    expect(HrExpiringListSchema.parse({ items: [ITEM, document], total: 2 }).items).toHaveLength(2)
    expect(HrExpiringListSchema.parse({ items: [], total: 0 }).total).toBe(0)
  })

  it('accepts an overdue item with a negative days_left', () => {
    expect(HrExpiringListSchema.parse({ items: [{ ...ITEM, days_left: -3 }], total: 1 }).items[0]?.days_left).toBe(-3)
  })

  it('rejects an unknown kind, a fractional days_left and extra keys', () => {
    expect(() => HrExpiringListSchema.parse({ items: [{ ...ITEM, kind: 'visa' }], total: 1 })).toThrow()
    expect(() => HrExpiringListSchema.parse({ items: [{ ...ITEM, days_left: 1.5 }], total: 1 })).toThrow()
    expect(() => HrExpiringListSchema.parse({ items: [{ ...ITEM, x: 1 }], total: 1 })).toThrow()
  })
})

describe('HrSaudizationSchema', () => {
  const COUNTS = { total: 3, saudi: 2, non_saudi: 1, unknown: 0, saudi_percent: 66.67 }

  it('accepts overall and per-department counts', () => {
    const parsed = HrSaudizationSchema.parse({
      overall: COUNTS,
      items: [{ department: { id: 4, name: 'الهندسة' }, ...COUNTS }, { department: null, ...COUNTS }],
      total: 2,
    })
    expect(parsed.items[1]?.department).toBeNull()
  })

  it('accepts a null percentage when no nationality is known', () => {
    const empty = { total: 0, saudi: 0, non_saudi: 0, unknown: 0, saudi_percent: null }
    expect(HrSaudizationSchema.parse({ overall: empty, items: [], total: 0 }).overall.saudi_percent).toBeNull()
  })

  it('rejects a percentage above 100 and extra keys', () => {
    expect(() => HrSaudizationSchema.parse({
      overall: { ...COUNTS, saudi_percent: 101 }, items: [], total: 0,
    })).toThrow()
    expect(() => HrSaudizationSchema.parse({ overall: COUNTS, items: [], total: 0, tier: 'green' })).toThrow()
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

  it('keeps every HR list envelope server-counted and rejects invalid totals', () => {
    expect(HrEmployeeListSchema.parse({ items: [EMPLOYEE], total: 1 })).toEqual({ items: [EMPLOYEE], total: 1 })
    expect(HrDepartmentListSchema.parse({ items: [DEPARTMENT], total: 1 }).total).toBe(1)
    expect(() => HrEmployeeListSchema.parse({ items: [], total: -1 })).toThrow()
    expect(() => HrDepartmentListSchema.parse({ items: [], total: -1 })).toThrow()
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
