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
  detail: (id: number) => ['projects', 'detail', id] as const,
  stages: (id: number) => ['projects', 'detail', id, 'stages'] as const,
  followers: (id: number) => ['projects', 'detail', id, 'followers'] as const,
  milestones: (id: number) => ['projects', 'detail', id, 'milestones'] as const,
  updates: (id: number) => ['projects', 'detail', id, 'updates'] as const,
}

interface ProjectCacheClient {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown
}

/**
 * Refresh every project view after a write that can change project state from
 * outside the project composables (task writes, dependency edits, realtime
 * notifications). Callers must not hand-roll the key list.
 */
export function invalidateProjectCaches(qc: ProjectCacheClient) {
  return qc.invalidateQueries({ queryKey: projectKeys.all })
}
