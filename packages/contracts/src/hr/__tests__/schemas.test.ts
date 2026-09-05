import {
  HrDepartmentSchema,
  HrDocumentAttachmentSchema,
  HrDocumentDetailSchema,
  HrDocumentSchema,
  HrEmployeeSchema,
} from '..'

const DEPARTMENT = {
  id: 4,
  name: 'الهندسة',
  parent_id: 1,
  manager: { id: 9, name: 'Sara' },
  child_ids: [5, 6],
}

const EMPLOYEE = {
  id: 10,
  name: 'Sara',
  job_title: 'مهندسة',
  department: { id: 4, name: 'الهندسة' },
  work_email: 'sara@example.com',
  work_phone: '+966500000000',
  user_id: 7,
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
