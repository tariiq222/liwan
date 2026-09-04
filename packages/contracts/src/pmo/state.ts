import { z } from 'zod'

export const TaskStateSchema = z.enum(['in_progress', 'changes_requested', 'approved', 'waiting', 'done', 'cancelled'])
export type TaskState = z.infer<typeof TaskStateSchema>

export const MANAGER_STATES: TaskState[] = ['approved', 'changes_requested']
