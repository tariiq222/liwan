import {
  ProjectCharterCatalogResourceSchema,
  ProjectCharterReferenceCreateSchema,
  ProjectCharterReferenceDeletedSchema,
  ProjectCharterReferenceListSchema,
  ProjectCharterReferencePatchSchema,
  ProjectCharterReferenceSchema,
} from '../project-charter-reference'

const ITEM = { id: 1, name: 'تقني', sequence: 10, active: true }
const TYPE_ITEM = { ...ITEM, charter_steps: ['justification', 'scope'] }

describe('ProjectCharterReferenceSchema', () => {
  it('accepts catalog items and the list envelope', () => {
    expect(ProjectCharterReferenceSchema.parse(ITEM).name).toBe('تقني')
    expect(ProjectCharterReferenceSchema.parse(ITEM).charter_steps).toBeUndefined()
    expect(ProjectCharterReferenceSchema.parse(TYPE_ITEM).charter_steps).toEqual(['justification', 'scope'])
    expect(() => ProjectCharterReferenceSchema.parse({ ...ITEM, charter_steps: ['signatures'] })).toThrow()
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
    expect(ProjectCharterReferenceCreateSchema.parse({ name: 'Light', charter_steps: ['scope'] }).charter_steps).toEqual(['scope'])
    expect(ProjectCharterReferencePatchSchema.parse({ charter_steps: [] }).charter_steps).toEqual([])
    expect(() => ProjectCharterReferencePatchSchema.parse({ charter_steps: ['nope'] })).toThrow()
    expect(ProjectCharterReferenceDeletedSchema.parse({ deleted: true })).toEqual({ deleted: true })
    expect(() => ProjectCharterReferenceCreateSchema.parse({ name: '' })).toThrow()
    expect(() => ProjectCharterReferencePatchSchema.parse({ name: '' })).toThrow()
  })
})
