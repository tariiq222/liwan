import type { TaskListParams } from '@/composables/useTasks'

// Single source of truth for the "my tasks" filter state so every consumer
// (the table's own toolbar, and the detail page's prev/next lookup) reads
// the exact same localStorage-backed ref/key/defaults rather than each
// re-declaring its own — a second declaration with different defaults would
// silently desync from what the table actually queried with.
export function useTaskFilters() {
  return useLocalStorage<TaskListParams>('liwan.tasks.filters', { closed: false }, { mergeDefaults: true })
}
