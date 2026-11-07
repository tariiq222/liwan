// The project cache namespace, kept free of schemas and vue-query so pure
// key/state modules (project governance, schedule) can share it without
// dragging a composable's dependencies into their tests.
//
// One root for every project cache entry, like `taskKeys`. A second root
// (`['project', id]`) used to hide detail, stages, followers, milestones and
// updates from `projectKeys.all`, so a task write refreshed the project list
// while the open project workspace kept serving stale progress.
export const projectKeys = {
  all: ['projects'] as const,
  list: ['projects', 'list'] as const,
  minimal: ['projects', 'minimal'] as const,
  summary: (query: object) => ['projects', 'summary', query] as const,
  analytics: (query: object) => ['projects', 'analytics', query] as const,
  detail: (id: number) => ['projects', 'detail', id] as const,
  stages: (id: number) => ['projects', 'detail', id, 'stages'] as const,
  followers: (id: number) => ['projects', 'detail', id, 'followers'] as const,
  milestones: (id: number) => ['projects', 'detail', id, 'milestones'] as const,
  updates: (id: number) => ['projects', 'detail', id, 'updates'] as const,
}

/** Live task-dependent project readings. Omitted fields mean a conservative realtime event. */
export function isTaskDependentProjectKey(key: readonly unknown[], projectIds?: ReadonlySet<number>, changedFields?: ReadonlySet<string>): boolean {
  if (key[0] !== 'projects') return false
  const affects = (...fields: string[]) => !changedFields || fields.some(field => changedFields.has(field))
  const aggregates = affects('date_deadline', 'liwan_planned_start', 'percent_complete', 'allocated_hours', 'stage_id', 'milestone_id', 'user_ids', 'state', 'active', 'project_id')
  if (['list', 'summary', 'analytics'].includes(key[1] as string)) return aggregates
  if (key[1] === 'attention') return affects('state', 'active', 'project_id')
  if (key[1] !== 'detail' || (projectIds && !projectIds.has(key[2] as number))) return false
  if (key.length === 3 || key[3] === 'milestones') return aggregates
  if (key[3] === 'stages') return affects('stage_id', 'user_ids', 'state', 'active', 'project_id')
  if (key[3] === 'evm' || (key[3] === 'baselines' && key[4] === 'variance')) return aggregates || affects('name')
  // A stage edit recomputes the state of a nonclosed task when planning is enabled.
  if (key[3] === 'schedule') return affects('name', 'liwan_planned_start', 'date_deadline', 'milestone_id', 'depend_on_ids', 'user_ids', 'stage_id', 'state', 'active', 'project_id')
  if (key[3] !== 'governance') return false
  if (key[4] === 'task-page') return affects('name', 'description', 'date_deadline', 'priority', 'user_ids', 'tag_ids', 'personal_stage_type_id', 'stage_id', 'state', 'active', 'project_id')
  return ['raci', 'register', 'register-item'].includes(key[4] as string) && affects('name', 'user_ids', 'state', 'active', 'project_id')
}

interface ProjectCacheClient {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown
}

/**
 * Refresh every project view after a write that can change project state from
 * outside the project composables. Scoped task edits and realtime notifications
 * use isTaskDependentProjectKey to preserve unrelated project views.
 */
export function invalidateProjectCaches(qc: ProjectCacheClient) {
  return qc.invalidateQueries({ queryKey: projectKeys.all })
}
