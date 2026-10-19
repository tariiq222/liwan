import * as contracts from '../index'
import type { z } from 'zod'

const summary = {
  id: 3, name: 'Policy', visibility: 'restricted', active: true, expiry_date: null,
  write_date: '2026-10-19T00:00:00Z', revision: 1, file_count: 0, tags: [], context: null,
  allowed_actions: { update: true, archive: true, restore: false, upload_file: true, manage_access: true },
}
const file = {
  id: 7, name: 'policy.txt', mimetype: 'text/plain', file_size: 14, active: true,
  is_locked: false, is_lock_editor: false, download_url: '/api/v1/documents/3/files/7/download',
  allowed_actions: { archive: true, restore: false, lock: true, unlock: false },
}
function schema(name: string): z.ZodType {
  const value = (contracts as Record<string, unknown>)[name]
  expect(value, `${name} must implement the document wire contract`).toBeDefined()
  return value as z.ZodType
}

describe('document contracts', () => {
  it('keeps HTML and files out of list summaries', () => {
    const s = schema('DocumentSummarySchema')
    expect(s.parse(summary)).toEqual(summary)
    expect(s.safeParse({ ...summary, body: '<p>secret</p>' }).success).toBe(false)
    expect(s.safeParse({ ...summary, files: [] }).success).toBe(false)
    expect(schema('DocumentListSchema').parse({ items: [summary], total: 1 })).toEqual({ items: [summary], total: 1 })
  })
  it('has one full strict detail shape with private download URLs', () => {
    const detail = { ...summary, body: '<p>Policy</p>', file_count: 1 }
    expect(schema('DocumentDetailSchema').parse(detail)).toEqual(detail)
    expect(schema('DocumentFileListSchema').parse({ items: [file], total: 250, revision: 1 })).toEqual({ items: [file], total: 250, revision: 1 })
    for (const extra of [{ files: [file] }, { grants: [] }, { attachment_ids: [] }, { storage_id: 4 }]) {
      expect(schema('DocumentDetailSchema').safeParse({ ...detail, ...extra }).success).toBe(false)
    }
    expect(schema('DocumentFileSchema').safeParse({ ...file, download_url: '/web/content/4?access_token=x' }).success).toBe(false)
    expect(schema('DocumentFileSchema').safeParse({ ...file, attachment_id: 4 }).success).toBe(false)
  })
  it('requires positive integer revision and a nonempty strict patch', () => {
    const s = schema('DocumentPatchSchema')
    expect(s.parse({ expected_revision: 1, body: '' })).toEqual({ expected_revision: 1, body: '' })
    for (const value of [{ name: 'Missing revision' }, { expected_revision: 1 }, { expected_revision: 0, name: 'x' },
      { expected_revision: 1.5, name: 'x' }, { expected_revision: 1, company_id: 9 },
      { expected_revision: 1, visibility: 'company' }, { expected_revision: 1, tag_ids: [2, 2] }]) {
      expect(s.safeParse(value).success).toBe(false)
    }
  })
  it('uses data for uploads and rejects old or privileged inputs', () => {
    const s = schema('DocumentUploadSchema')
    expect(s.parse({ expected_revision: 1, name: 'x.txt', data: 'eA==' })).toEqual({ expected_revision: 1, name: 'x.txt', data: 'eA==' })
    for (const extra of [{ datas: 'eA==' }, { attachment_id: 4 }, { directory_id: 9 }, { company_id: 2 }]) {
      expect(s.safeParse({ expected_revision: 1, name: 'x.txt', data: 'eA==', ...extra }).success).toBe(false)
    }
    expect(s.safeParse({ expected_revision: 1, name: '../x', data: 'eA==' }).success).toBe(false)
  })
  it('keeps access responses separate and requires an editor in replacements', () => {
    const access = { visibility: 'restricted', revision: 1, grants: [{ user: { id: 5, name: 'Sara' }, access: 'editor' }] }
    expect(schema('DocumentAccessSchema').parse(access)).toEqual(access)
    const write = schema('DocumentAccessUpdateSchema')
    expect(write.safeParse({ expected_revision: 1, visibility: 'company', grants: [] }).success).toBe(false)
    expect(write.safeParse({ expected_revision: 1, visibility: 'restricted', grants: [{ user_id: 5, access: 'reader' }] }).success).toBe(false)
    expect(write.safeParse({ expected_revision: 1, visibility: 'restricted', grants: [{ user_id: 5, access: 'editor' }] }).success).toBe(true)
  })
  it('uses a context reference without accepting arbitrary model/field parameters', () => {
    const create = schema('DocumentCreateSchema')
    expect(create.safeParse({ name: 'x', context: { kind: 'hr.department', id: 1 } }).success).toBe(true)
    expect(create.safeParse({ name: 'x', context: { kind: 'hr.department', id: 1, model: 'res.users' } }).success).toBe(false)
    expect(create.safeParse({ name: 'x', context: { kind: 'hr.department', id: -1 } }).success).toBe(false)
    expect(create.safeParse({ name: 'x', revision: 99 }).success).toBe(false)
  })
})
