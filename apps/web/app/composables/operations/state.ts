import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

// Application-owned tone map; the shared badge owns the visual recipe.
const tones: Record<string, StatusTone> = { draft: 'neutral', waiting: 'neutral', pending: 'info', returned: 'warning', rejected: 'destructive', withdrawn: 'neutral', done: 'success', approved: 'success', skipped: 'neutral', published: 'success', archived: 'neutral' }
export const operationsStateTone = (state: string): StatusTone => tones[state] ?? 'neutral'
