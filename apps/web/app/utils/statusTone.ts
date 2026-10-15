/** The semantic tones every status badge uses (DESIGN.md §2: status colours are fixed). `primary` marks the system/admin role only. */
export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'destructive' | 'primary'

export const STATUS_COLOR = {
  neutral: 'neutral', info: 'info', warning: 'warning', success: 'success', destructive: 'error', primary: 'primary',
} as const satisfies Record<StatusTone, 'neutral' | 'info' | 'warning' | 'success' | 'error' | 'primary'>

/** Risk score heat (probability x impact): 1-6 info, 7-12 warning, 13 and above error. */
export function riskScoreTone(score: number | null | undefined): StatusTone {
  if (!score || score < 1) return 'neutral'
  if (score <= 6) return 'info'
  return score <= 12 ? 'warning' : 'destructive'
}

/** Task priority (Odoo '0'-'3' or the personal-task names): normal is neutral, high warns, urgent is an error. */
export function priorityTone(priority: string | number | null | undefined): StatusTone {
  switch (String(priority ?? '')) {
    case '1': case '2': case 'high': return 'warning'
    case '3': case 'urgent': return 'destructive'
    default: return 'neutral'
  }
}
