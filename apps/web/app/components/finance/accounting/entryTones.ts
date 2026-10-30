import type { JournalEntry } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

export const ENTRY_STATE_TONE: Record<JournalEntry['state'], StatusTone> = {
  draft: 'neutral',
  posted: 'success',
  cancel: 'destructive',
}
