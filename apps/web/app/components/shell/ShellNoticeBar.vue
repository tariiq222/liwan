<script setup lang="ts">
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import type { ShellNotice, ShellNoticeSeverity } from '@/utils/shellNotices'

// The one subscription notice above the page content (selection and dismissal rules live in `useShellNotice`).
// It draws exactly the notice it is given: its text, its one action, and a close button only when the notice allows it.
const props = defineProps<{ notice: ShellNotice }>()
const emit = defineEmits<{ dismiss: [] }>()
const { t } = useI18n()

const ICONS: Record<ShellNoticeSeverity, string> = { error: 'i-lucide-lock', warning: 'i-lucide-triangle-alert', info: 'i-lucide-info' }
// Params named `date` are ISO calendar days; the rest are plain numbers.
const message = computed(() => {
  const { date, ...rest } = props.notice.params
  return t(props.notice.messageKey, date === undefined ? rest : { ...rest, date: formatDate(String(date)) })
})
const actions = computed(() => props.notice.action
  ? [{ label: t(props.notice.action.labelKey), to: props.notice.action.to, color: props.notice.severity, variant: 'solid' as const }]
  : undefined)
</script>

<template>
  <UAlert
    data-testid="shell-notice"
    :data-notice="notice.key"
    :role="notice.severity === 'error' ? 'alert' : 'status'"
    :color="notice.severity"
    variant="subtle"
    :icon="ICONS[notice.severity]"
    :description="message"
    :actions="actions"
    :close="notice.dismissible !== false"
    @update:open="emit('dismiss')"
  />
</template>
