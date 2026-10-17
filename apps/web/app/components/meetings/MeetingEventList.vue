<script setup lang="ts">
import { formatWebVueDateTime } from '@webvue/ui/app/composables/calendarDate'

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
  title?: string
  description?: string
}>(), { loading: false, total: 0, page: 1, pageSize: 25, title: undefined, description: undefined })
const emit = defineEmits<{ retry: []; page: [page: number] }>()
const { t, te, locale } = useI18n()
const pages = computed(() => Math.max(1, Math.ceil((props.total ?? 0) / props.pageSize)))
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
  return formatWebVueDateTime(value, locale.value)
}
function hasInformativeSummary(event: MeetingEvent) {
  const summary = event.summary.trim()
  const normalized = summary.replace(/[.!؟?]+$/, '').trim().toLocaleLowerCase()
  if (/^meeting state changed to (draft|confirmed|done|cancelled)$/i.test(summary.replace(/[.!]+$/, ''))) return false
  return Boolean(summary) && !genericSummaries.has(normalized) && summary !== kindLabel(event.kind)
}
</script>

<template>
  <SharedRecordSection data-testid="meeting-event-list" variant="list" :title="title || t('meetingMinutesForm.history')" :description="description">
    <SharedPageState :loading="loading" :error="error" :empty="!events.length" :empty-text="t('meetingMinutesForm.noHistory')" @retry="emit('retry')">
      <ol class="divide-y divide-default">
        <li v-for="event in events" :key="event.id" class="grid min-w-0 gap-1 px-(--webvue-card-pad) py-3">
          <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span class="font-semibold text-highlighted">{{ kindLabel(event.kind) }}</span>
            <time class="text-xs text-muted" :datetime="event.occurred_at">{{ occurredAt(event.occurred_at) }}</time>
          </div>
          <p v-if="hasInformativeSummary(event)" class="whitespace-pre-wrap break-words text-sm text-default">{{ event.summary }}</p>
          <div class="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted">
            <SharedPersonAvatar v-if="event.actor" :people="[event.actor]" />
            <span>{{ event.actor?.name || t('meetingMinutesForm.systemActor') }}</span>
            <template v-if="event.meeting_name"><span aria-hidden="true">·</span><span>{{ event.meeting_name }}</span></template>
          </div>
        </li>
      </ol>
    </SharedPageState>
    <div v-if="pages > 1" class="border-t border-default px-(--webvue-card-pad) py-3">
      <SharedPagination :page="page" :pages="pages" :disabled="loading" @update:page="emit('page', $event)" />
    </div>
  </SharedRecordSection>
</template>
