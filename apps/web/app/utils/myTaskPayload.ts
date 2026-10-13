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

/** The request body of the create form: empty optionals are omitted and `parent_id` is never sent (sub-tasks are added from the detail page). */
export function buildMyTaskPayload(values: MyTaskFormValues): MyTaskCreate {
  const name = values.name.trim()
  const description = values.description.trim()
  const body: MyTaskCreate = { name, priority: values.priority }
  if (description) body.description = description
  if (values.deadline) body.date_deadline = values.deadline
  if (values.assignees.length) body.assignees = [...values.assignees]
  return body
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
