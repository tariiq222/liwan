<script setup lang="ts">
import { useMeetingSeries } from '@/composables/useMeetings'
import { formatCalendarDate } from '@/composables/calendarDate'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
import { formatLocalDateTime } from '@/utils/meetingDateTime'
import { selectNextMeeting, selectPreviousMeeting } from '@/utils/meetingWorkspace'

const route = useRoute()
const { t, locale } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const id = computed(() => Number(route.params.id))
const isDetail = computed(() => route.path === `/meetings/series/${id.value}`)
const query = useMeetingSeries(computed(() => isDetail.value ? id.value : null))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/meetings/series', ['/meetings']))
const occurrenceSearch = ref('')
const occurrenceState = ref('')
const now = ref(new Date())
const upcoming = computed(() => selectNextMeeting(query.data.value?.meetings ?? [], now.value))
const previous = computed(() => selectPreviousMeeting(query.data.value?.meetings ?? [], now.value))
const filteredMeetings = computed(() => (query.data.value?.meetings ?? []).filter((meeting) => {
  const q = occurrenceSearch.value.trim().toLocaleLowerCase()
  return (!occurrenceState.value || meeting.state === occurrenceState.value)
    && (!q || meeting.name.toLocaleLowerCase().includes(q))
}))

function localTime(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return formatLocalDateTime(value)
  return new Intl.DateTimeFormat(locale.value, { timeStyle: 'short', calendar: 'gregory' }).format(parsed)
}

function occurrenceLabel(meeting: { meeting_date: string | null; start_datetime: string | null }) {
  const date = meeting.meeting_date ? formatCalendarDate(meeting.meeting_date, locale.value) : '—'
  return meeting.start_datetime ? `${date} · ${localTime(meeting.start_datetime)}` : date
}
const canAddOccurrence = computed(() => {
  const series = query.data.value
  const userId = me.value?.id
  return can('meetings.create') && (
    can('meetings.manage') ||
    (userId !== undefined && (series?.organizer?.id === userId || series?.secretary?.id === userId))
  )
})
</script>

<template>
  <SharedPageContainer v-if="isDetail" width="detail">
    <SharedPageHeader :title="query.data.value?.name || t('nav.meetingSeries')" :back-to="backTo">
      <template #actions>
        <NuxtLink v-if="query.data.value?.can_edit === true" class="edit-settings" :to="{ path: `/meetings/series/${id}/edit`, query: { returnTo: route.fullPath } }">
          <Button variant="outline">{{ t('meetingsUx.seriesSettingsLink') }}</Button>
        </NuxtLink>
        <NuxtLink v-if="canAddOccurrence" :to="{ path: '/meetings/new', query: { ...returnToQuery(route.fullPath), series_id: String(id) } }">
          <Button>{{ t('meetingsUi.addOccurrence') }}</Button>
        </NuxtLink>
      </template>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <div v-if="query.data.value" class="grid gap-4">
        <section class="nasq-panel overflow-hidden">
          <div class="nasq-panel-header"><h2>{{ t('meetingsUi.series') }}</h2></div>
          <div class="nasq-panel-body nasq-metadata">
            <div><dt>{{ t('meetingsUi.organizer') }}</dt><dd>{{ query.data.value.organizer?.name }}</dd></div>
            <div><dt>{{ t('meetingsUi.recurrenceLabel') }}</dt><dd>{{ t(`meetingsUi.recurrence.${query.data.value.recurrence}`) }}</dd></div>
            <div><dt>{{ t('meetingsUi.project') }}</dt><dd>{{ query.data.value.project?.name || '—' }}</dd></div>
            <div><dt>{{ t('meetingsUi.secretary') }}</dt><dd>{{ query.data.value.secretary?.name || '—' }}</dd></div>
            <div><dt>{{ t('meetingsUi.location') }}</dt><dd>{{ query.data.value.location || '—' }}</dd></div>
            <div v-if="query.data.value.meeting_url"><dt>{{ t('meetingsUi.url') }}</dt><dd><a :href="query.data.value.meeting_url" target="_blank" rel="noopener" class="break-all text-brand-link underline" dir="ltr">{{ query.data.value.meeting_url }}</a></dd></div>
            <div><dt>{{ t('meetingsUx.attendees') }}</dt><dd>{{ query.data.value.attendees.map(person => person.name).join('، ') || '—' }}</dd></div>
            <div><dt>{{ t('meetingsUx.termination') }}</dt><dd>{{ query.data.value.until_count ? t('meetingsUx.terminationCount', { count: query.data.value.until_count }) : query.data.value.until_date ? formatCalendarDate(query.data.value.until_date, locale) : t('meetingsUx.terminationOpen') }}</dd></div>
            <div><dt>{{ t('meetingsUi.openCount', { count: query.data.value.open_resolution_count }) }}</dt><dd>{{ t('meetingsUi.overdueCount', { count: query.data.value.overdue_resolution_count }) }}</dd></div>
          </div>
        </section>
        <section class="nasq-panel nasq-panel-body grid gap-2">
          <p v-if="upcoming">{{ t('meetingsUi.nextMeeting') }}: <NuxtLink :to="{ path: `/meetings/${upcoming.id}`, query: returnToQuery(route.fullPath) }" class="text-brand-link">{{ upcoming.name }} · {{ occurrenceLabel(upcoming) }}</NuxtLink></p>
          <p v-else class="text-sm text-muted-foreground">{{ t('meetingsUx.noNextMeeting') }}</p>
          <p v-if="previous">{{ t('meetingsUi.previousMeeting') }}: <NuxtLink :to="{ path: `/meetings/${previous.id}`, query: returnToQuery(route.fullPath) }" class="text-brand-link">{{ previous.name }} · {{ occurrenceLabel(previous) }}</NuxtLink></p>
        </section>
        <section class="nasq-panel overflow-hidden">
          <div class="nasq-toolbar border-b border-border">
            <Input v-model="occurrenceSearch" :placeholder="t('meetingsUx.searchOccurrences')" :aria-label="t('meetingsUx.searchOccurrences')" />
            <select v-model="occurrenceState" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :aria-label="t('meetingsUi.stateLabel')">
              <option value="">{{ t('meetingsUi.allStates') }}</option>
              <option v-for="state in ['draft', 'confirmed', 'done', 'cancelled']" :key="state" :value="state">{{ t(`meetingsUi.state.${state}`) }}</option>
            </select>
          </div>
          <p v-if="!filteredMeetings.length" class="p-4 text-sm text-muted-foreground">{{ t('meetingsUx.noMatchingOccurrences') }}</p>
          <NuxtLink
            v-for="meeting in filteredMeetings"
            :key="meeting.id"
            :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
            class="flex min-w-0 flex-wrap items-center gap-3 border-b border-border p-3 last:border-0 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span class="min-w-0 flex-1 break-words">{{ meeting.name }}</span>
            <span class="ms-auto text-end text-sm text-muted-foreground">{{ occurrenceLabel(meeting) }} · {{ t(`meetingsUi.state.${meeting.state}`) }}</span>
          </NuxtLink>
        </section>
      </div>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
