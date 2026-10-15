/** The semantic tones every status badge uses (DESIGN.md §2: status colours are fixed). `primary` marks the system/admin role only. */
export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'destructive' | 'primary'

export const STATUS_COLOR = {
  neutral: 'neutral', info: 'info', warning: 'warning', success: 'success', destructive: 'error', primary: 'primary',
} as const satisfies Record<StatusTone, 'neutral' | 'info' | 'warning' | 'success' | 'error' | 'primary'>

