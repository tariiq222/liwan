import {
  ProjectCharterCatalogResourceSchema,
  ProjectCharterReferenceCreateSchema,
  ProjectCharterReferenceDeletedSchema,
  ProjectCharterReferenceListSchema,
  ProjectCharterReferencePatchSchema,
  ProjectCharterReferenceSchema,
} from '../project-charter-reference'

const ITEM = { id: 1, name: 'تقني', sequence: 10, active: true }

describe('ProjectCharterReferenceSchema', () => {
  it('accepts catalog items and the list envelope', () => {
    expect(ProjectCharterReferenceSchema.parse(ITEM).name).toBe('تقني')
    expect(ProjectCharterReferenceListSchema.parse({ items: [ITEM], total: 1 }).total).toBe(1)
    expect(ProjectCharterCatalogResourceSchema.options).toEqual(['types', 'owning-units'])
  })
  it('rejects unknown resources and extra keys', () => {
    expect(() => ProjectCharterCatalogResourceSchema.parse('departments')).toThrow()
    expect(() => ProjectCharterReferenceSchema.parse({ ...ITEM, company_id: 1 })).toThrow()
  })
})

describe('catalog mutations', () => {
  it('accepts create/patch/delete shapes', () => {
    expect(ProjectCharterReferenceCreateSchema.parse({ name: 'Ops' })).toEqual({ name: 'Ops' })
    expect(ProjectCharterReferencePatchSchema.parse({ name: 'Operations', active: false }).active).toBe(false)
    expect(ProjectCharterReferenceDeletedSchema.parse({ deleted: true })).toEqual({ deleted: true })
    expect(() => ProjectCharterReferenceCreateSchema.parse({ name: '' })).toThrow()
    expect(() => ProjectCharterReferencePatchSchema.parse({ name: '' })).toThrow()
  })
})
