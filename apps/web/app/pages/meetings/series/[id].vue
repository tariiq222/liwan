<script setup lang="ts">
import { useMeetingSeries } from '@/composables/useMeetings'
import { formatCalendarDate } from '@/composables/calendarDate'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t, locale } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const id = computed(() => Number(route.params.id))
const query = useMeetingSeries(id)
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/meetings/series', ['/meetings']))
const today = computed(() => new Date().toISOString().slice(0, 10))
const upcoming = computed(() => (query.data.value?.meetings ?? []).filter(item => (item.meeting_date || '') >= today.value).sort((a, b) => (a.meeting_date || '').localeCompare(b.meeting_date || ''))[0])
const previous = computed(() => (query.data.value?.meetings ?? []).filter(item => (item.meeting_date || '') < today.value).sort((a, b) => (b.meeting_date || '').localeCompare(a.meeting_date || ''))[0])
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
  <SharedPageContainer width="detail">
    <SharedPageHeader :title="query.data.value?.name || t('nav.meetingSeries')" :back-to="backTo">
      <template #actions>
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
            <div><dt>{{ t('meetingsUi.openCount', { count: query.data.value.open_resolution_count }) }}</dt><dd>{{ t('meetingsUi.overdueCount', { count: query.data.value.overdue_resolution_count }) }}</dd></div>
          </div>
        </section>
        <section class="nasq-panel nasq-panel-body grid gap-2">
          <p v-if="upcoming">{{ t('meetingsUi.nextMeeting') }}: <NuxtLink :to="{ path: `/meetings/${upcoming.id}`, query: returnToQuery(route.fullPath) }" class="text-brand-link">{{ upcoming.name }} · {{ upcoming.meeting_date && formatCalendarDate(upcoming.meeting_date, locale) }}</NuxtLink></p>
          <p v-if="previous">{{ t('meetingsUi.previousMeeting') }}: <NuxtLink :to="{ path: `/meetings/${previous.id}`, query: returnToQuery(route.fullPath) }" class="text-brand-link">{{ previous.name }} · {{ previous.meeting_date && formatCalendarDate(previous.meeting_date, locale) }}</NuxtLink></p>
        </section>
        <section class="nasq-panel overflow-hidden">
          <NuxtLink
            v-for="meeting in query.data.value.meetings"
            :key="meeting.id"
            :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
            class="flex min-w-0 flex-wrap items-center gap-3 border-b border-border p-3 last:border-0 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span class="min-w-0 flex-1 break-words">{{ meeting.name }}</span>
            <span class="ms-auto text-end text-sm text-muted-foreground">{{ meeting.meeting_date }} · {{ t(`meetingsUi.state.${meeting.state}`) }}</span>
          </NuxtLink>
        </section>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
