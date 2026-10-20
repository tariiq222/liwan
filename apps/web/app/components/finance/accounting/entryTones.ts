import type { JournalEntry } from '@webvue/contracts'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'

export const ENTRY_STATE_TONE: Record<JournalEntry['state'], StatusTone> = {
  draft: 'neutral',
  posted: 'success',
  cancel: 'destructive',
}
