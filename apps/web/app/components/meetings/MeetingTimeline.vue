<script setup lang="ts">
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
  <div v-else-if="view === 'table'" class="overflow-x-auto">
    <table class="w-full min-w-[760px] text-sm">
      <thead>
        <tr class="border-b text-start">
          <th scope="col" class="w-28 p-3 text-start">{{ t('app.recordNumber') }}</th>
          <th scope="col" class="p-3 text-start">{{ t('meetingTimeline.session') }}</th>
          <th scope="col" class="p-3 text-start">{{ t('meetingsUi.date') }}</th>
          <th scope="col" class="p-3 text-start">{{ t('meetingsUi.stateLabel') }}</th>
          <th scope="col" class="p-3 text-start">{{ t('meetingsUi.resolutions') }}</th>
          <th scope="col" class="p-3 text-start" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="meeting in meetings" :key="meeting.id" class="border-b last:border-0" :class="meeting.id === nextMeetingId ? 'bg-brand-soft/50' : ''">
          <td class="p-3"><RecordNumber :value="meeting.reference || meeting.id" /></td>
          <th scope="row" class="p-3 text-start font-medium">
            <NuxtLink :to="meetingTo(meeting)" class="text-brand-link underline-offset-4 hover:underline">{{ meeting.name }}</NuxtLink>
          </th>
          <td class="p-3 text-muted-foreground">{{ meetingDate(meeting) }}</td>
          <td class="p-3"><Badge variant="outline">{{ t(`meetingsUi.state.${meeting.state}`) }}</Badge><span class="ms-2 text-xs text-muted-foreground">{{ t(`meetingTimeline.phase.${phase(meeting)}`) }}</span></td>
          <td class="p-3 tabular-nums">{{ meeting.open_resolution_count }}</td>
          <td class="p-3 text-end"><NuxtLink :to="meetingTo(meeting, 'minutes')" class="text-brand-link underline-offset-4 hover:underline">{{ t('meetingTimeline.openMinutes') }}</NuxtLink></td>
        </tr>
      </tbody>
    </table>
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
            <Badge v-if="meeting.id === nextMeetingId" variant="secondary">{{ t('meetingTimeline.next') }}</Badge>
            <Badge variant="outline">{{ t(`meetingsUi.state.${meeting.state}`) }}</Badge>
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
