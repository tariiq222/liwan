import type { MyTaskCreate } from '@/composables/useMyTasks'

export const MY_TASK_NAME_MAX = 255

export interface MyTaskFormValues {
  name: string
  description: string
  /** `YYYY-MM-DD`, the value of the date field, or null. */
  deadline: string | null
  priority: 'normal' | 'high'
  /** `/api/v1/people` user ids. */
  assignees: number[]
}

/**
 * The request body of a personal task form. A create omits empty optionals and never carries
 * `parent_id` (sub-tasks are added from the detail page); an edit sends every field so that a
 * cleared description, deadline or assignee list is really emptied.
 */
export function buildMyTaskPayload(values: MyTaskFormValues, mode: 'create' | 'edit'): MyTaskCreate {
  const name = values.name.trim()
  const description = values.description.trim()
  if (mode === 'edit') {
    return { name, description, date_deadline: values.deadline || null, priority: values.priority, assignees: [...values.assignees] }
  }
  const body: MyTaskCreate = { name, priority: values.priority }
  if (description) body.description = description
  if (values.deadline) body.date_deadline = values.deadline
  if (values.assignees.length) body.assignees = [...values.assignees]
  return body
}

/**
 * The API returns a deadline as a UTC instant (`...T00:00:00Z`) and accepts a bare date on input,
 * which it stores as that day's UTC midnight. Reading the UTC calendar day back keeps the round trip
 * stable in every viewer zone; converting to the local zone would shift the day west of UTC.
 */
export function deadlineToDateInput(value: string | null | undefined): string | null {
  const match = value ? /^(\d{4}-\d{2}-\d{2})T/.exec(value) : null
  return match ? match[1]! : null
}

export function validateMyTaskName(name: string): 'required' | 'tooLong' | null {
  const trimmed = name.trim()
  if (!trimmed) return 'required'
  return trimmed.length > MY_TASK_NAME_MAX ? 'tooLong' : null
}

// The fields the personal task form shows. A server error that names one of them belongs under it;
// `user_ids` is the storage name of `assignees`.
const FORM_FIELDS = ['name', 'description', 'date_deadline', 'priority', 'assignees'] as const
const FIELD_ALIASES: Record<string, string> = { user_ids: 'assignees' }

/** The form field a server error names, or null for no field or one the form does not show. */
export function myTaskFormField(field: string | null | undefined): string | null {
  if (!field) return null
  const resolved = FIELD_ALIASES[field] ?? field
  return (FORM_FIELDS as readonly string[]).includes(resolved) ? resolved : null
}
