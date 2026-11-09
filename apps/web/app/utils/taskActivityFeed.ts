import type { TimelineEntry } from '@liwan/contracts'

export type ActivityFilter = 'all' | 'comments' | 'log'

// The task's activity is one feed: comments and field changes in the order they happened (oldest first, so the
// composer below continues the conversation). The filter keeps one kind; the sort is stable for equal instants.
export function activityFeed(entries: readonly TimelineEntry[], filter: ActivityFilter): TimelineEntry[] {
  return entries
    .filter(entry => filter === 'all' || (entry.kind === 'comment') === (filter === 'comments'))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => new Date(a.entry.at).getTime() - new Date(b.entry.at).getTime() || b.index - a.index)
    .map(({ entry }) => entry)
}
