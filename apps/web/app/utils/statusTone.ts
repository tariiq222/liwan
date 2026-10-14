/** The five semantic tones every status badge uses (Tasmim spec §3: status colours are fixed). */
export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'destructive'

export const STATUS_COLOR = {
  neutral: 'neutral', info: 'info', warning: 'warning', success: 'success', destructive: 'error',
} as const satisfies Record<StatusTone, 'neutral' | 'info' | 'warning' | 'success' | 'error'>
