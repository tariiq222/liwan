// The columns of the task table that the person can show or hide («الأعمدة» in the toolbar). The title is always there.
// The choice is one cookie shared by both variants of the table, so a column the other variant does not have is simply
// not offered. The record number and the stage are off until asked for.
export const TASK_COLUMN_IDS = ['record_number', 'project', 'stage', 'state', 'priority', 'deadline', 'assignees'] as const
export type TaskColumnId = (typeof TASK_COLUMN_IDS)[number]
/** `mine`: the all-projects lists, which have a project column. `project`: one project's list, which has the stage instead. */
export type TaskTableVariant = 'mine' | 'project'

/** The cookie that remembers the visible columns; read on the server, so the table never flashes the wrong set. */
export const TASK_COLUMNS_COOKIE = 'liwan-task-columns'
export const DEFAULT_TASK_COLUMNS: readonly TaskColumnId[] = ['project', 'state', 'priority', 'deadline', 'assignees']

/** The columns a variant has, in reading order after the title. */
export function taskColumnOptions(variant: TaskTableVariant): TaskColumnId[] {
  return TASK_COLUMN_IDS.filter(id => variant === 'project' ? id !== 'project' : true)
}

/** The chosen columns of a cookie value (a comma list); an absent cookie is the default set, an empty one means title only. */
export function parseTaskColumns(raw: unknown): TaskColumnId[] {
  if (typeof raw !== 'string') return [...DEFAULT_TASK_COLUMNS]
  const listed = raw.split(',')
  return TASK_COLUMN_IDS.filter(id => listed.includes(id))
}

/** The columns a variant draws: its own columns that are chosen, in reading order. */
export function visibleTaskColumns(variant: TaskTableVariant, chosen: readonly TaskColumnId[]): TaskColumnId[] {
  return taskColumnOptions(variant).filter(id => chosen.includes(id))
}

/** The chosen columns after turning one on or off. */
export function toggleTaskColumn(chosen: readonly TaskColumnId[], id: TaskColumnId, on: boolean): TaskColumnId[] {
  return TASK_COLUMN_IDS.filter(column => column === id ? on : chosen.includes(column))
}
