<script setup lang="ts">
import { formatNasqDateTime } from '@/composables/calendarDate'

type MeetingEvent = {
  id: number
  meeting_id: number
  meeting_name: string
  occurred_at: string
  actor: { id: number; name: string } | null
  kind: string
  summary: string
}

const props = withDefaults(defineProps<{
  events: MeetingEvent[]
  loading?: boolean
  error?: unknown
  total?: number
  page?: number
  pageSize?: number
}>(), { loading: false, total: 0, page: 1, pageSize: 25 })
const emit = defineEmits<{ retry: []; page: [page: number] }>()
const { t, te, locale } = useI18n()
const hydrated = useHydrated()
const pages = computed(() => Math.max(1, Math.ceil((props.total ?? 0) / props.pageSize)))
const errorText = computed(() => props.error instanceof Error ? props.error.message : t('errors.generic'))
const genericSummaries = new Set([
  'meeting created',
  'meeting updated',
  'meeting details updated',
  'meeting confirmed',
  'meeting completed',
  'meeting reopened',
  'meeting cancelled',
  'meeting state changed',
  'minutes saved',
  'meeting minutes updated',
  'recommendation created',
  'recommendation updated',
  'recommendation changed',
])

function kindLabel(kind: string) {
  const key = `meetingMinutesForm.eventKinds.${kind}`
  return te(key) ? t(key) : t('meetingMinutesForm.eventKinds.generic')
}
function occurredAt(value: string) {
  return formatNasqDateTime(value, locale.value)
}
function hasInformativeSummary(event: MeetingEvent) {
  const summary = event.summary.trim()
  const normalized = summary.replace(/[.!؟?]+$/, '').trim().toLocaleLowerCase()
  if (/^meeting state changed to (draft|confirmed|done|cancelled)$/i.test(summary.replace(/[.!]+$/, ''))) return false
  return Boolean(summary) && !genericSummaries.has(normalized) && summary !== kindLabel(event.kind)
}
</script>

<template>
  <UCard data-testid="meeting-event-list">
    <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('meetingMinutesForm.history') }}</h2></template>
    <div class="grid gap-3">
      <div v-if="loading" class="grid gap-2" role="status" aria-busy="true" :aria-label="t('app.loading')"><USkeleton v-for="row in 4" :key="row" class="h-12 w-full" /></div>
      <UAlert v-else-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="errorText">
        <template #actions><UButton type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('meetingMinutesForm.retry')" @click="emit('retry')" /></template>
      </UAlert>
      <SharedEmptyState v-else-if="!events.length" :title="t('meetingMinutesForm.noHistory')" />
      <ol v-else class="grid gap-2">
        <li v-for="event in events" :key="event.id" class="grid min-w-0 gap-1 rounded-lg bg-default p-3 ring ring-default">
          <div class="flex min-w-0 flex-wrap items-center justify-between gap-2"><span class="font-medium text-highlighted">{{ kindLabel(event.kind) }}</span><time class="text-xs text-muted" :datetime="event.occurred_at">{{ occurredAt(event.occurred_at) }}</time></div>
          <span v-if="event.meeting_name" class="text-xs text-muted">{{ event.meeting_name }}</span>
          <p v-if="hasInformativeSummary(event)" class="whitespace-pre-wrap break-words text-sm">{{ event.summary }}</p>
          <span class="text-xs text-muted">{{ event.actor?.name || t('meetingMinutesForm.systemActor') }}</span>
        </li>
      </ol>
      <SharedPagination :page="page" :pages="pages" :disabled="loading" @update:page="emit('page', $event)" />
    </div>
  </UCard>
</template>
