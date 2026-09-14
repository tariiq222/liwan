import type { StateTone } from '@/composables/taskState'

export const STATUS_COLOR = {
  neutral: 'neutral', info: 'info', warning: 'warning', success: 'success', destructive: 'error',
} as const satisfies Record<StateTone, 'neutral' | 'info' | 'warning' | 'success' | 'error'>
