import {
  CrmImportBatchListSchema,
  CrmImportFileInfoSchema,
  CrmImportFileSchema,
  CrmImportMappingCreateSchema,
  CrmImportMappingSchema,
  CrmImportPreviewSchema,
  CrmImportRequestSchema,
} from '../index'

const columns = { name: 'Name', phone: 'Phone' }

describe('CrmImportRequestSchema', () => {
  it('needs a mapping or a saved profile', () => {
    const file = { file_name: 'customers.csv', content_base64: 'TmFtZQ==' }
    expect(CrmImportRequestSchema.parse({ ...file, mapping: columns, source_id: 3 }).source_id).toBe(3)
    expect(CrmImportRequestSchema.parse({ ...file, mapping_profile: 4, source_id: 3 }).mapping_profile).toBe(4)
    expect(() => CrmImportRequestSchema.parse({ ...file, source_id: 3 })).toThrow()
    expect(() => CrmImportRequestSchema.parse({ ...file, mapping: columns })).toThrow()
  })

  it('requires name and phone columns and rejects unknown ones', () => {
    expect(CrmImportMappingCreateSchema.parse({ name: 'Sheet', columns }).columns).toEqual(columns)
    expect(() => CrmImportMappingCreateSchema.parse({ name: 'Sheet', columns: { name: 'Name' } })).toThrow()
    expect(() => CrmImportMappingCreateSchema.parse({ name: 'Sheet', columns: { ...columns, city: 'City' } })).toThrow()
  })
})

describe('import responses', () => {
  it('accepts the preview, mapping and batch serializer shapes', () => {
    const preview = {
      new: 2,
      duplicate: 1,
      invalid: 1,
      invalid_rows: [{ row: 3, reason: 'invalid_phone' }],
      duplicate_rows: [4],
    }
    expect(CrmImportPreviewSchema.parse(preview)).toEqual(preview)
    const mapping = { id: 1, name: 'Sheet', columns: { ...columns, email: null, notes: null, package: null } }
    expect(CrmImportMappingSchema.parse(mapping)).toEqual(mapping)
    const batch = {
      id: 5,
      file_name: 'customers.csv',
      user: { id: 2, name: 'Manager' },
      source: null,
      created: 2,
      duplicate: 1,
      invalid: 1,
      unassigned: 2,
      created_at: '2026-10-28T09:00:00Z',
    }
    expect(CrmImportBatchListSchema.parse({ items: [batch], total: 1 }).total).toBe(1)
  })

  it('rejects an unknown invalid reason and a leaked existing record', () => {
    const base = { new: 0, duplicate: 1, invalid: 0, invalid_rows: [], duplicate_rows: [2] }
    expect(() => CrmImportPreviewSchema.parse({ ...base, invalid_rows: [{ row: 2, reason: 'other' }] })).toThrow()
    expect(() => CrmImportPreviewSchema.parse({ ...base, existing: [{ id: 9 }] })).toThrow()
  })
})

describe('import file routes', () => {
  it('accepts the columns request and response shapes', () => {
    const request = { file_name: 'customers.csv', content_base64: 'TmFtZQ==' }
    expect(CrmImportFileSchema.parse(request)).toEqual(request)
    expect(() => CrmImportFileSchema.parse({ ...request, source_id: 1 })).toThrow()
    const info = { columns: ['Name', 'Phone'], rows: 3 }
    expect(CrmImportFileInfoSchema.parse(info)).toEqual(info)
    expect(() => CrmImportFileInfoSchema.parse({ ...info, rows: -1 })).toThrow()
  })

  it('refuses a mapping together with a profile', () => {
    const file = { file_name: 'customers.csv', content_base64: 'TmFtZQ==' }
    expect(() => CrmImportRequestSchema.parse({ ...file, mapping: columns, mapping_profile: 4, source_id: 3 })).toThrow()
  })
})
