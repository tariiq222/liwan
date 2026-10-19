import { describe, expect, it } from 'vitest'
import {
  TaskAttachmentListSchema,
  TaskAttachmentSchema,
  TaskAttachmentUploadSchema,
} from '../attachment'

const ATTACHMENT = {
  id: 42,
  name: 'brief.pdf',
  mimetype: 'application/pdf',
  url: '/api/v1/tasks/7/attachments/42/download',
}

describe('TaskAttachmentSchema', () => {
  it('accepts the server attachment shape', () => {
    expect(TaskAttachmentSchema.parse(ATTACHMENT)).toEqual(ATTACHMENT)
  })

  it('rejects unknown fields and non-positive ids', () => {
    expect(() => TaskAttachmentSchema.parse({ ...ATTACHMENT, extra: true })).toThrow()
    expect(() => TaskAttachmentSchema.parse({ ...ATTACHMENT, id: 0 })).toThrow()
  })
})

describe('TaskAttachmentListSchema', () => {
  it('accepts the list envelope and validates total', () => {
    expect(TaskAttachmentListSchema.parse({ items: [ATTACHMENT], total: 1 }).total).toBe(1)
    expect(() => TaskAttachmentListSchema.parse({ items: [], total: -1 })).toThrow()
  })
})

describe('TaskAttachmentUploadSchema', () => {
  it('accepts the base64 upload request and rejects extra keys', () => {
    expect(TaskAttachmentUploadSchema.parse({ name: 'brief.txt', mimetype: 'text/plain', data: 'aGVsbG8=' }).data).toBe('aGVsbG8=')
    expect(() => TaskAttachmentUploadSchema.parse({ name: 'x', data: 'a', url: 'https://example.test' })).toThrow()
  })
})

