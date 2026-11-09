// The scope of a project's task list: open work, finished work (`?closed=1`) or archived tasks (`?scope=archived`).
// Archived is the existing archived-tasks query, shown inside the same list card instead of on a page of its own.
export const TASK_SCOPES = ['open', 'closed', 'archived'] as const
export type TaskScope = (typeof TASK_SCOPES)[number]

export function projectTaskScope(query: Record<string, unknown>): TaskScope {
  if (query.scope === 'archived') return 'archived'
  return query.closed === '1' ? 'closed' : 'open'
}

/** The query keys that carry a scope (undefined removes the key). Changing scope drops a state filter the other scope cannot hold. */
export function projectTaskScopeQuery(scope: TaskScope): { closed: string | undefined; scope: string | undefined; state: undefined } {
  return { closed: scope === 'closed' ? '1' : undefined, scope: scope === 'archived' ? 'archived' : undefined, state: undefined }
}
