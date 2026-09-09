<script setup lang="ts">
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
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short', calendar: 'gregory' }).format(date)
}
function hasInformativeSummary(event: MeetingEvent) {
  const summary = event.summary.trim()
  const normalized = summary.replace(/[.!؟?]+$/, '').trim().toLocaleLowerCase()
  if (/^meeting state changed to (draft|confirmed|done|cancelled)$/i.test(summary.replace(/[.!]+$/, ''))) return false
  return Boolean(summary) && !genericSummaries.has(normalized) && summary !== kindLabel(event.kind)
}
</script>

<template>
  <section class="nasq-panel grid gap-3" data-testid="meeting-event-list">
    <div class="nasq-panel-header"><h2>{{ t('meetingMinutesForm.history') }}</h2></div>
    <div class="nasq-panel-body grid gap-3">
      <div v-if="loading" class="grid gap-2" aria-busy="true"><Skeleton v-for="row in 4" :key="row" class="h-12 w-full" /></div>
      <div v-else-if="error" class="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive" role="alert"><span>{{ errorText }}</span><Button type="button" variant="outline" size="sm" :disabled="!hydrated" @click="emit('retry')">{{ t('meetingMinutesForm.retry') }}</Button></div>
      <div v-else-if="!events.length" class="text-sm text-muted-foreground">{{ t('meetingMinutesForm.noHistory') }}</div>
      <ol v-else class="grid gap-2">
        <li v-for="event in events" :key="event.id" class="grid min-w-0 gap-1 rounded-lg border border-border p-3">
          <div class="flex min-w-0 flex-wrap items-center justify-between gap-2"><span class="font-medium">{{ kindLabel(event.kind) }}</span><time class="text-xs text-muted-foreground" :datetime="event.occurred_at">{{ occurredAt(event.occurred_at) }}</time></div>
          <span v-if="event.meeting_name" class="text-xs text-muted-foreground">{{ event.meeting_name }}</span>
          <p v-if="hasInformativeSummary(event)" class="whitespace-pre-wrap break-words text-sm">{{ event.summary }}</p>
          <span class="text-xs text-muted-foreground">{{ event.actor?.name || t('meetingMinutesForm.systemActor') }}</span>
        </li>
      </ol>
      <nav v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground" :aria-label="t('meetingMinutesForm.pagination')">
        <Button type="button" variant="ghost" :disabled="!hydrated || loading || page <= 1" @click="emit('page', page - 1)">{{ t('meetingMinutesForm.previous') }}</Button>
        <span>{{ t('meetingMinutesForm.pageOf', { page, pages }) }}</span>
        <Button type="button" variant="ghost" :disabled="!hydrated || loading || page >= pages" @click="emit('page', page + 1)">{{ t('meetingMinutesForm.next') }}</Button>
      </nav>
    </div>
  </section>
</template>
