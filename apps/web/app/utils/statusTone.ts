import type { StateTone } from '@/composables/taskState'

export const STATUS_CHIP_CLASS: Record<StateTone, string> = {
  neutral: 'nasq-status-chip-muted',
  info: 'nasq-status-chip-info',
  warning: 'nasq-status-chip-warning',
  success: 'nasq-status-chip-success',
  destructive: 'nasq-status-chip-danger',
}

export const STATUS_TEXT_CLASS: Record<StateTone, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-brand-link',
  warning: 'nasq-status-text-warning',
  success: 'nasq-status-text-success',
  destructive: 'nasq-status-text-danger',
}
