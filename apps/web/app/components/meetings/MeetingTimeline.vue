<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { MeetingListItem } from '@nasq/contracts'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { formatCalendarDate } from '@/composables/calendarDate'
import { groupMeetingsByMonth, meetingTimelinePhase } from '@/utils/meetingWorkspace'
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
  return new Intl.DateTimeFormat(locale.value, { timeStyle: 'short', calendar: 'gregory' }).format(parsed)
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
  <div v-if="!meetings.length" class="p-6 text-center text-sm text-muted-foreground">
    {{ t('meetingTimeline.empty') }}
  </div>
  <div v-else-if="view === 'table'" class="min-w-0 overflow-x-auto">
    <div class="grid gap-2 md:hidden">
      <article v-for="meeting in meetings" :key="meeting.id" class="grid gap-2 rounded-lg border border-default p-3" :class="meeting.id === nextMeetingId ? 'bg-brand-soft/50' : ''">
        <div class="flex flex-wrap items-start justify-between gap-2"><NuxtLink :to="meetingTo(meeting)" class="font-medium text-brand-link underline-offset-4 hover:underline">{{ meeting.name }}</NuxtLink><UBadge color="neutral" variant="outline">{{ t(`meetingsUi.state.${meeting.state}`) }}</UBadge></div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted"><RecordNumber :value="meeting.reference || meeting.id" /><span>{{ meetingDate(meeting) }}</span><span>{{ t('meetingsUi.openCount', { count: meeting.open_resolution_count }) }}</span></div>
        <NuxtLink :to="meetingTo(meeting, 'minutes')" class="text-sm text-brand-link underline-offset-4 hover:underline">{{ t('meetingTimeline.openMinutes') }}</NuxtLink>
      </article>
    </div>
    <div class="hidden md:block">
    <UTable :data="meetings" :columns="tableColumns" :ui="{ base: 'min-w-[760px]' }">
      <template #reference-cell="{ row }"><RecordNumber :value="row.original.reference || row.original.id" /></template>
      <template #name-cell="{ row }"><NuxtLink :to="meetingTo(row.original)" class="font-medium text-brand-link underline-offset-4 hover:underline">{{ row.original.name }}</NuxtLink></template>
      <template #meeting_date-cell="{ row }"><span class="text-muted">{{ meetingDate(row.original) }}</span></template>
      <template #state-cell="{ row }"><UBadge color="neutral" variant="outline">{{ t(`meetingsUi.state.${row.original.state}`) }}</UBadge><span class="ms-2 text-xs text-muted">{{ t(`meetingTimeline.phase.${phase(row.original)}`) }}</span></template>
      <template #actions-cell="{ row }"><NuxtLink :to="meetingTo(row.original, 'minutes')" class="text-brand-link underline-offset-4 hover:underline">{{ t('meetingTimeline.openMinutes') }}</NuxtLink></template>
    </UTable>
    </div>
  </div>
  <div v-else class="space-y-6">
    <section v-for="group in groups" :key="group.key" :aria-labelledby="`meeting-month-${group.key}`">
      <h3 :id="`meeting-month-${group.key}`" class="mb-2 text-sm font-semibold text-muted-foreground">{{ group.label }}</h3>
      <ol class="relative ms-2 border-s border-border">
        <li v-for="meeting in group.meetings" :key="meeting.id" class="relative ms-4 border-b border-border/70 pb-4 ps-5 pt-1 last:border-b-0" :class="meeting.id === nextMeetingId ? 'rounded-lg bg-brand-soft/50' : ''">
          <span class="absolute -start-[5px] top-3 size-2 rounded-full bg-border" :class="meeting.id === nextMeetingId ? 'bg-brand-link ring-4 ring-ring/20' : ''" aria-hidden="true" />
          <div class="flex min-w-0 flex-wrap items-start gap-2">
            <RecordNumber :value="meeting.reference || meeting.id" class="shrink-0" />
            <NuxtLink :to="meetingTo(meeting)" class="min-w-0 flex-1 font-medium text-brand-link underline-offset-4 hover:underline">{{ meeting.name }}</NuxtLink>
            <UBadge v-if="meeting.id === nextMeetingId" color="primary" variant="subtle">{{ t('meetingTimeline.next') }}</UBadge>
            <UBadge color="neutral" variant="outline">{{ t(`meetingsUi.state.${meeting.state}`) }}</UBadge>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <time :datetime="meeting.start_datetime || meeting.meeting_date || undefined" dir="ltr">{{ meetingDate(meeting) }}</time>
            <span>{{ t(`meetingTimeline.phase.${phase(meeting)}`) }}</span>
            <span>{{ t('meetingsUi.openCount', { count: meeting.open_resolution_count }) }}</span>
            <NuxtLink :to="meetingTo(meeting, 'minutes')" class="text-brand-link underline-offset-4 hover:underline">{{ t('meetingTimeline.openMinutes') }}</NuxtLink>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>
