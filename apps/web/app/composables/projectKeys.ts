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
  detail: (id: number) => ['projects', 'detail', id] as const,
  stages: (id: number) => ['projects', 'detail', id, 'stages'] as const,
  followers: (id: number) => ['projects', 'detail', id, 'followers'] as const,
  milestones: (id: number) => ['projects', 'detail', id, 'milestones'] as const,
  updates: (id: number) => ['projects', 'detail', id, 'updates'] as const,
}

/** Live project readings that depend on tasks; baseline snapshots and governance stay unchanged. */
export function isTaskDependentProjectKey(key: readonly unknown[], projectIds?: ReadonlySet<number>): boolean {
  if (key[0] !== 'projects') return false
  if (key[1] === 'list' || key[1] === 'summary') return true
  if (key[1] !== 'detail' || (projectIds && !projectIds.has(key[2] as number))) return false
  return key.length === 3 || ['stages', 'milestones', 'evm'].includes(key[3] as string)
    || (key[3] === 'baselines' && key[4] === 'variance')
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
