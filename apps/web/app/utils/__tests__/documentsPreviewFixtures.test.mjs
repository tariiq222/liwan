import { expect, it } from 'vitest'
import { DocumentDetailSchema, DocumentListSchema, DocumentContextListSchema, DocumentContextOptionListSchema } from '@liwan/contracts'
import { documentsPreviewData } from '../../../e2e/documents-ui-preview-data.mjs'
it('validates summary and detail previews and filters canonical context ids', () => {
  const path = '/api/v1/documents'
  const list = DocumentListSchema.parse(documentsPreviewData(path, new URL('http://localhost'+path+'?context_kind=hr.department&context_id=2')))
  expect(list.total).toBe(2); expect(list.items.map(item => item.id)).toEqual([2, 3]); expect(list.items[0]).not.toHaveProperty('body')
  expect(DocumentDetailSchema.parse(documentsPreviewData(path+'/1', new URL('http://localhost'+path+'/1'))).body).toBeTruthy()
  for (const [suffix, schema] of [['/contexts', DocumentContextListSchema], ['/contexts/hr.department/options', DocumentContextOptionListSchema]]) expect(schema.safeParse(documentsPreviewData(path+suffix, new URL('http://localhost'+path+suffix))).success).toBe(true)
})
it('filters the preview list by visibility and expiry like the API', () => {
  const ids = query => DocumentListSchema.parse(documentsPreviewData('/api/v1/documents', new URL('http://localhost/api/v1/documents?' + query))).items.map(item => item.id)
  expect(ids('visibility=restricted')).toEqual([1])
  expect(ids('expiring_within=30')).toEqual([1])
  expect(ids('expired=1')).toEqual([2])
})
