import type { PersonalTask } from '@nasq/contracts'
import { MAX_ATTACHMENT_BYTES } from './attachmentFile'
import { deadlineDay } from './myTaskList'

// Pure helpers of the personal task detail page: draft diffing and
// client-side attachment / comment checks. The server stays the authority for every rule.

export const COMMENT_MAX_LENGTH = 5000

const ALLOWED_TYPES: Record<string, readonly string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  txt: ['text/plain'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
}

export interface DetailDraft {
  name: string
  description: string
  date_deadline: string | null
  priority: PersonalTask['priority']
  assignees: number[]
}

export function draftFromTask(task: PersonalTask): DetailDraft {
  return {
    name: task.name,
    description: task.description,
    date_deadline: deadlineDay(task.date_deadline),
    priority: task.priority,
    assignees: task.assignees.map(person => person.id),
  }
}

const sameIds = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && [...a].sort((x, y) => x - y).every((id, index) => id === [...b].sort((x, y) => x - y)[index])

/** Only the fields that differ from the task: the PATCH body of an inline edit. */
export function changedFields(task: PersonalTask, draft: DetailDraft): Partial<DetailDraft> {
  const before = draftFromTask(task)
  const body: Partial<DetailDraft> = {}
  if (draft.name.trim() !== before.name) body.name = draft.name.trim()
  if (draft.description !== before.description) body.description = draft.description
  if (draft.date_deadline !== before.date_deadline) body.date_deadline = draft.date_deadline
  if (draft.priority !== before.priority) body.priority = draft.priority
  if (!sameIds(draft.assignees, before.assignees)) body.assignees = [...draft.assignees]
  return body
}

export type AttachmentProblem = 'empty' | 'tooLarge' | 'type'

export function attachmentProblem(file: { name: string; size: number; type: string }): AttachmentProblem | null {
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : ''
  const allowed = ALLOWED_TYPES[extension]
  if (!allowed) return 'type'
  // A browser may report no type at all; a reported type must still match the extension.
  if (file.type && !allowed.includes(file.type.toLowerCase())) return 'type'
  if (file.size <= 0) return 'empty'
  if (file.size > MAX_ATTACHMENT_BYTES) return 'tooLarge'
  return null
}

export type CommentProblem = 'empty' | 'tooLong'

export function commentProblem(text: string): CommentProblem | null {
  const body = text.trim()
  if (!body) return 'empty'
  return body.length > COMMENT_MAX_LENGTH ? 'tooLong' : null
}

/** Comments read oldest first; ties keep the server's id order. */
export function oldestFirst<T extends { id: number; created_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id))
}
