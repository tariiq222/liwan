import { describe, expect, it } from 'vitest'
import type { PersonalTask } from '@webvue/contracts'
import {
  changedFields, commentProblem, draftFromTask, oldestFirst,
} from '../myTaskDetail'
import { MAX_ATTACHMENT_BYTES, attachmentProblem } from '../attachmentFile'

const task: PersonalTask = {
  id: 7, name: 'اشترِ الورق', description: 'ورق A4', state: 'open', priority: 'normal',
  date_deadline: '2026-10-20T21:30:00Z',
  assignees: [{ id: 5, name: 'سارة', user_id: 5 }, { id: 2, name: 'Admin', user_id: 2 }],
  creator: { id: 2, name: 'Admin', user_id: 2 }, parent: null, is_subtask: false, subtasks: [], attachment_count: 0,
  created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z',
  allowed_actions: { write: true, done: true, reopen: false, cancel: true, convert: false },
}

describe('changedFields', () => {
  it('is empty for an untouched draft', () => {
    expect(changedFields(task, draftFromTask(task))).toEqual({})
  })
  it('lists only the edited fields', () => {
    const draft = { ...draftFromTask(task), name: ' اشترِ أوراقًا ', priority: 'high' as const }
    expect(changedFields(task, draft)).toEqual({ name: 'اشترِ أوراقًا', priority: 'high' })
  })
  it('treats the same assignees in another order as unchanged', () => {
    expect(changedFields(task, { ...draftFromTask(task), assignees: [2, 5] })).toEqual({})
    expect(changedFields(task, { ...draftFromTask(task), assignees: [2] })).toEqual({ assignees: [2] })
  })
  it('clears and sets the deadline', () => {
    expect(changedFields(task, { ...draftFromTask(task), date_deadline: null })).toEqual({ date_deadline: null })
    expect(changedFields(task, { ...draftFromTask(task), date_deadline: '2026-10-21' })).toEqual({ date_deadline: '2026-10-21' })
  })
})

describe('attachmentProblem', () => {
  const file = (name: string, size = 10, type = '') => ({ name, size, type })
  it('accepts the allowed types by extension, with or without a reported type', () => {
    for (const name of ['a.pdf', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.txt', 'a.docx', 'a.xlsx']) expect(attachmentProblem(file(name))).toBeNull()
    expect(attachmentProblem(file('a.pdf', 10, 'application/pdf'))).toBeNull()
  })
  it('rejects other types and mismatching reported types', () => {
    expect(attachmentProblem(file('a.exe'))).toBe('type')
    expect(attachmentProblem(file('noextension'))).toBe('type')
    expect(attachmentProblem(file('a.pdf', 10, 'image/png'))).toBe('type')
  })
  it('rejects empty and oversized files', () => {
    expect(attachmentProblem(file('a.pdf', 0))).toBe('empty')
    expect(attachmentProblem(file('a.pdf', MAX_ATTACHMENT_BYTES))).toBeNull()
    expect(attachmentProblem(file('a.pdf', MAX_ATTACHMENT_BYTES + 1))).toBe('tooLarge')
  })
})

describe('commentProblem', () => {
  it('checks the 1 to 5000 character bounds after trimming', () => {
    expect(commentProblem('   ')).toBe('empty')
    expect(commentProblem('ok')).toBeNull()
    expect(commentProblem('x'.repeat(5000))).toBeNull()
    expect(commentProblem('x'.repeat(5001))).toBe('tooLong')
  })
})

describe('oldestFirst', () => {
  it('orders by time then id without mutating the input', () => {
    const rows = [
      { id: 3, created_at: '2026-10-02T00:00:00Z' },
      { id: 2, created_at: '2026-10-01T00:00:00Z' },
      { id: 1, created_at: '2026-10-01T00:00:00Z' },
    ]
    expect(oldestFirst(rows).map(row => row.id)).toEqual([1, 2, 3])
    expect(rows.map(row => row.id)).toEqual([3, 2, 1])
  })
})
