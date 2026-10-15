<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { MeetingListItem } from '@nasq/contracts'
import RecordNumber from '@/components/shared/data/RecordNumber.vue'
import { formatCalendarDate, formatNasqTime } from '@/composables/calendarDate'
import { groupMeetingsByMonth, meetingTimelinePhase } from '@/utils/meetingWorkspace'
import { meetingStateBadgeProps } from '@/utils/meetingStatus'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = withDefaults(defineProps<{
  meetings: MeetingListItem[]
  nextMeetingId?: number | null
  view?: 'timeline' | 'table'
  preserveOrder?: boolean
  returnTo?: string
  now?: Date
}>(), { nextMeetingId: null, view: 'timeline', preserveOrder: false, returnTo: undefined, now: undefined })

const route = useRoute()
const { t, locale } = useI18n()
const now = computed(() => props.now ?? new Date())
const groups = computed(() => groupMeetingsByMonth(props.meetings, locale.value, now.value, t('meetingTimeline.unknownDate'), props.preserveOrder))
const tableColumns = computed<TableColumn<MeetingListItem>[]>(() => [
  { accessorKey: 'reference', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('meetingTimeline.session') },
  { accessorKey: 'meeting_date', header: t('meetingsUi.date') },
  { accessorKey: 'state', header: t('meetingsUi.stateLabel') },
  { accessorKey: 'open_resolution_count', header: t('meetingsUi.resolutions') },
  { id: 'actions', header: t('app.actions') },
])

function phase(meeting: MeetingListItem) {
  return meetingTimelinePhase(meeting, now.value)
}

function localTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return t('meetingTimeline.unknownDate')
  return formatNasqTime(parsed, locale.value)
}

function meetingDate(meeting: MeetingListItem) {
  if (meeting.meeting_date) {
    const date = formatCalendarDate(meeting.meeting_date, locale.value)
    return meeting.start_datetime ? `${date} · ${localTime(meeting.start_datetime)}` : date
  }
  return meeting.start_datetime ? localTime(meeting.start_datetime) : t('meetingTimeline.unknownDate')
}

function meetingTo(meeting: MeetingListItem, tab?: string) {
  return {
    path: `/meetings/${meeting.id}`,
    query: {
      ...returnToQuery(props.returnTo ?? route.fullPath),
      ...(tab ? { tab } : {}),
    },
  }
}
</script>

<template>
  <SharedEmptyState v-if="!meetings.length" :title="t('meetingTimeline.empty')" />
  <SharedDataTable
    v-else-if="view === 'table'"
    :rows="meetings"
    :columns="tableColumns"
    row-key="id"
    :row-to="meetingTo"
    :caption="t('meetingTimeline.session')"
  >
    <template #reference-cell="{ row }"><RecordNumber :value="row.original.reference || row.original.id" />
    </template>
    <template #name-cell="{ row }">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <NuxtLink :to="meetingTo(row.original)" class="min-w-0 font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.name }}</NuxtLink>
        <UBadge v-if="row.original.id === nextMeetingId" color="primary" variant="subtle">{{ t('meetingTimeline.next') }}</UBadge>
      </div>
    </template>
    <template #meeting_date-cell="{ row }"><span class="text-muted">{{ meetingDate(row.original) }}</span></template>
    <template #state-cell="{ row }">
      <SharedStatusBadge v-bind="meetingStateBadgeProps(row.original.state, t)" />
      <span class="ms-2 text-xs text-muted">{{ t(`meetingTimeline.phase.${phase(row.original)}`) }}</span>
    </template>
    <template #open_resolution_count-cell="{ row }">{{ t('meetingsUi.openCount', { count: row.original.open_resolution_count }, row.original.open_resolution_count) }}</template>
    <template #actions-cell="{ row }"><UButton color="primary" variant="link" size="sm" class="p-0" :to="meetingTo(row.original, 'minutes')" :label="t('meetingTimeline.openMinutes')" />
    </template>
    <template #mobile-row="{ row }">
      <div class="grid gap-2">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <NuxtLink :to="meetingTo(row)" class="min-w-0 font-medium text-primary">{{ row.name }}</NuxtLink>
          <div class="flex shrink-0 items-center gap-1">
            <UBadge v-if="row.id === nextMeetingId" color="primary" variant="subtle">{{ t('meetingTimeline.next') }}</UBadge>
            <SharedStatusBadge v-bind="meetingStateBadgeProps(row.state, t)" />
          </div>
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted"><RecordNumber :value="row.reference || row.id" /><span>{{ meetingDate(row) }}</span><span>{{ t('meetingsUi.openCount', { count: row.open_resolution_count }, row.open_resolution_count) }}</span></div>
        <UButton color="primary" variant="link" size="sm" class="w-fit p-0" :to="meetingTo(row, 'minutes')" :label="t('meetingTimeline.openMinutes')" />
      </div>
    </template>
  </SharedDataTable>
  <div v-else class="space-y-6">
    <section v-for="group in groups" :key="group.key" :aria-labelledby="`meeting-month-${group.key}`">
      <h3 :id="`meeting-month-${group.key}`" class="mb-2 text-sm font-semibold text-muted">{{ group.label }}</h3>
      <ol class="relative ms-2 border-s border-default">
        <li v-for="meeting in group.meetings" :key="meeting.id" class="relative ms-4 border-b border-default pb-4 ps-5 pt-1 last:border-b-0" :class="meeting.id === nextMeetingId ? 'rounded-lg bg-primary/10' : ''">
          <span class="absolute -start-[5px] top-3 size-2 rounded-full" :class="meeting.id === nextMeetingId ? 'bg-primary ring-4 ring-primary/20' : 'bg-accented'" aria-hidden="true" />
          <div class="flex min-w-0 flex-wrap items-start gap-2">
            <RecordNumber :value="meeting.reference || meeting.id" class="shrink-0" />
            <UButton color="primary" variant="link" class="min-w-0 flex-1 p-0 font-medium whitespace-normal text-start" :to="meetingTo(meeting)">{{ meeting.name }}</UButton>
            <UBadge v-if="meeting.id === nextMeetingId" color="primary" variant="subtle">{{ t('meetingTimeline.next') }}</UBadge>
            <SharedStatusBadge v-bind="meetingStateBadgeProps(meeting.state, t)" />
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <time :datetime="meeting.start_datetime || meeting.meeting_date || undefined" dir="ltr">{{ meetingDate(meeting) }}</time>
            <span>{{ t(`meetingTimeline.phase.${phase(meeting)}`) }}</span>
            <span>{{ t('meetingsUi.openCount', { count: meeting.open_resolution_count }, meeting.open_resolution_count) }}</span>
            <UButton color="primary" variant="link" size="xs" class="p-0" :to="meetingTo(meeting, 'minutes')" :label="t('meetingTimeline.openMinutes')" />
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>
