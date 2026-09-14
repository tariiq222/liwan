import type { PillTone } from '@/utils/statusTone'

// Meeting states map onto the shared status-pill tones (components.css).
export const MEETING_STATE_TONE: Record<string, PillTone> = {
  draft: 'waiting',
  confirmed: 'in_progress',
  done: 'done',
  cancelled: 'cancelled',
}
export function meetingStateTone(state: string): PillTone {
  return MEETING_STATE_TONE[state] ?? 'neutral'
}
