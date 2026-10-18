import type { AiThreadItem } from '@/composables/useAiRun'

/** The index of the newest confirm or draft card still waiting for a decision, or -1: only that one is the page's `action` block. */
export function latestPendingIndex(items: readonly AiThreadItem[]): number {
  return items.findLastIndex(item => (item.kind === 'confirm' || item.kind === 'draft') && item.state === 'pending')
}
