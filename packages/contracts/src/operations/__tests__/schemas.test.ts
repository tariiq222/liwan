import { describe, expect, it } from 'vitest'
import { OperationProcessSchema, OperationRequestSchema } from '../index'
const person = { id: 7, user_id: 7, name: 'Reviewer' }
const process = { id: 1, name: 'Approval', purpose: 'work', description: '', state: 'published', revision: 1, execution_kind: 'approval', steps: [{ name: 'Review', reviewer_ids: [7], reviewers: [person] }] }
const request = { id: 2, name: 'Request', purpose: 'work', description: '', target: null, process: { id: 1, name: 'Approval' }, process_revision: 1, state: 'pending', revision: 1, cycle: 1, requester: person, created_at: '2026-10-14T00:00:00Z', execution_count: 0, steps: [{ sequence: 1, name: 'Review', reviewers: [person], status: 'pending' }], events: [], attachments: [], allowed_actions: { edit: false, submit: false, approve: true, reject: true, return: true, withdraw: false } }
describe('operation wire contracts', () => {
  it('requires explicit purpose on process and request responses', () => {
    for (const purpose of ['work', 'employee']) {
      expect(OperationProcessSchema.safeParse({ ...process, purpose }).success).toBe(true)
      expect(OperationRequestSchema.safeParse({ ...request, purpose }).success).toBe(true)
    }
    expect(OperationProcessSchema.safeParse({ ...process, purpose: undefined }).success).toBe(false)
    expect(OperationRequestSchema.safeParse({ ...request, purpose: undefined }).success).toBe(false)
    expect(OperationRequestSchema.safeParse({ ...request, purpose: 'personal' }).success).toBe(false)
  })
  it('accepts published stages and the pending reviewer response', () => {
    expect(OperationProcessSchema.safeParse(process).success).toBe(true)
    expect(OperationRequestSchema.safeParse(request).success).toBe(true)
  })
  it('accepts canceled downstream stages on a returned request', () => {
    expect(OperationRequestSchema.safeParse({ ...request, state: 'returned', steps: [{ ...request.steps[0], status: 'cancel' }] }).success).toBe(true)
  })
  it('refuses an unrecognized state and unwhitelisted server internals', () => {
    expect(OperationRequestSchema.safeParse({ ...request, state: 'sudo' }).success).toBe(false)
    expect(OperationRequestSchema.safeParse({ ...request, execution_token: 'forged' }).success).toBe(false)
  })
  it('rejects missing reviewer identity and fractional revisions', () => {
    expect(OperationProcessSchema.safeParse({ ...process, steps: [{ name: 'Review', reviewer_ids: [0], reviewers: [] }] }).success).toBe(false)
    expect(OperationRequestSchema.safeParse({ ...request, revision: 1.5 }).success).toBe(false)
  })
})
