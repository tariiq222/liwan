import { expect, it } from 'vitest'
import { createDocumentDraft } from '../../../lib/documentEditorDraft'
const document = { id: 8, revision: 3, name: 'Policy', body: '<p>Original</p>', expiry_date: null, context: null, tags: [] }
it('keeps a local draft and original revision across refetch/conflict until an explicit reload', () => {
  const draft = createDocumentDraft()
  draft.receive(document)
  draft.body = '<p>Local unsaved</p>'
  draft.receive({ ...document, revision: 4, body: '<p>Other tab</p>' })
  expect(draft.patch()).toEqual({ expected_revision: 3, body: '<p>Local unsaved</p>' })
  expect(draft.isDirty()).toBe(true)
  draft.reload({ ...document, revision: 4, body: '<p>Other tab</p>' })
  expect(draft.body).toBe('<p>Other tab</p>')
  expect(draft.revision).toBe(4)
  expect(draft.isDirty()).toBe(false)
})
it('seeds a different record once and accepts the acknowledged save', () => {
  const draft = createDocumentDraft(); draft.receive(document); draft.name = 'Changed'
  draft.reload({ ...document, name: 'Changed', revision: 4 })
  expect(draft.isDirty()).toBe(false)
  draft.receive({ ...document, id: 9, name: 'Second', revision: 1 })
  expect(draft.name).toBe('Second'); expect(draft.revision).toBe(1)
})
it('does not re-submit an unchanged provider context when editing content', () => {
  const draft = createDocumentDraft()
  draft.receive({ ...document, context: { kind: 'hr.department', id: 7, label: null, href: null } })
  draft.body = '<p>Only content changed</p>'
  expect(draft.patch()).toEqual({ expected_revision: 3, body: '<p>Only content changed</p>' })
})
