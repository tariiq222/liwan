<script setup lang="ts">
import {
  formatMeetingDate,
  formatMeetingTime,
  plainTextFromHtml,
  type MeetingMinutesFormValue,
  type MeetingMinutesRecommendation,
} from '@/utils/meetingMinutesForm'

type MeetingMetadata = {
  name: string
  reference?: string | null
  meeting_date?: string | null
  start_datetime?: string | null
  end_datetime?: string | null
  location?: string | null
  organizer?: { name: string } | null
  secretary?: { name: string } | null
  attendees?: Array<{ id: number; name: string }>
}

type TopicRow = {
  topic: MeetingMinutesFormValue['topics'][number]
  recommendation: MeetingMinutesRecommendation | null
}

const props = withDefaults(defineProps<{
  form?: MeetingMinutesFormValue | null
  meeting: MeetingMetadata
  snapshot?: Partial<MeetingMetadata> | null
  recommendations?: MeetingMinutesRecommendation[]
  legacyAgenda?: string | null
  legacyMinutes?: string | null
  legacyRecommendations?: MeetingMinutesRecommendation[]
  title?: string
}>(), { form: null, snapshot: null, recommendations: () => [], legacyAgenda: '', legacyMinutes: '', legacyRecommendations: () => [], title: '' })
const { t, locale } = useI18n()
const displayMeeting = computed(() => {
  if (!props.snapshot) return props.meeting
  return {
    name: props.snapshot.name ?? '',
    reference: props.snapshot.reference ?? props.meeting.reference,
    meeting_date: props.snapshot.meeting_date,
    start_datetime: props.snapshot.start_datetime,
    end_datetime: props.snapshot.end_datetime,
    location: props.snapshot.location,
    organizer: props.snapshot.organizer,
    secretary: props.snapshot.secretary,
    attendees: props.snapshot.attendees,
  }
})
const legacyAgendaText = computed(() => plainTextFromHtml(props.legacyAgenda))
const legacyMinutesText = computed(() => plainTextFromHtml(props.legacyMinutes))
const legacyRecommendations = computed(() => props.legacyRecommendations.length ? props.legacyRecommendations : props.recommendations)

function recommendationFor(id: number) {
  return props.recommendations.find(item => item.id === id) ?? props.legacyRecommendations.find(item => item.id === id)
}
const topicRows = computed<TopicRow[]>(() => {
  if (!props.form) return []
  return props.form.topics.flatMap(topic => topic.resolution_ids.length
    ? topic.resolution_ids.map(id => ({ topic, recommendation: recommendationFor(id) ?? null }))
    : [{ topic, recommendation: null }])
})
const assignedRecommendationIds = computed(() => new Set(props.form?.topics.flatMap(topic => topic.resolution_ids) ?? []))
const unassignedRecommendations = computed(() => props.recommendations.filter(item => !assignedRecommendationIds.value.has(item.id)))
</script>

<template>
  <UCard data-testid="meeting-minutes-document" :ui="{ root: 'print:shadow-none print:ring-0', header: 'print:px-0', body: 'print:px-0' }">
    <template #header><h2 class="text-lg font-semibold text-highlighted">{{ title || t('meetingMinutesForm.documentTitle') }}</h2></template>
    <div class="grid gap-5">
      <dl class="grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.name') }}</dt><dd class="break-words">{{ displayMeeting.name || '—' }}</dd></div>
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.reference') }}</dt><dd dir="ltr">{{ displayMeeting.reference || '—' }}</dd></div>
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.date') }}</dt><dd>{{ formatMeetingDate(displayMeeting.meeting_date, locale) }}</dd></div>
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.time') }}</dt><dd dir="ltr"><bdi>{{ formatMeetingTime(displayMeeting.start_datetime, locale) }}</bdi><span v-if="displayMeeting.end_datetime"> – <bdi>{{ formatMeetingTime(displayMeeting.end_datetime, locale) }}</bdi></span></dd></div>
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.location') }}</dt><dd>{{ displayMeeting.location || '—' }}</dd></div>
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.secretary') }}</dt><dd>{{ displayMeeting.secretary?.name || '—' }}</dd></div>
      </dl>
      <div class="text-sm"><span class="text-muted">{{ t('meetingMinutesForm.attendees') }}:</span> {{ displayMeeting.attendees?.map(person => person.name).join('، ') || '—' }}</div>

      <template v-if="form">
        <div class="grid gap-1"><h3 class="font-semibold text-highlighted">{{ t('meetingMinutesForm.opening') }}</h3><p class="whitespace-pre-wrap text-sm">{{ form.opening || '—' }}</p></div>
        <section v-if="legacyAgendaText" class="grid gap-2"><h3 class="font-semibold text-highlighted">{{ t('meetingsUi.agenda') }}</h3><p class="whitespace-pre-wrap text-sm">{{ legacyAgendaText }}</p></section>
        <section v-if="legacyMinutesText" class="grid gap-2"><h3 class="font-semibold text-highlighted">{{ t('meetingsUi.minutes') }}</h3><p class="whitespace-pre-wrap text-sm">{{ legacyMinutesText }}</p></section>
        <div class="grid gap-3">
          <h3 class="font-semibold text-highlighted">{{ t('meetingMinutesForm.topics') }}</h3>
          <div class="overflow-x-auto rounded-lg ring ring-default print:overflow-visible print:ring-0">
            <table class="meeting-minutes-topic-table min-w-[980px] w-full text-sm">
              <thead><tr><th>{{ t('meetingMinutesForm.topicTitle') }}</th><th>{{ t('meetingMinutesForm.discussion') }}</th><th>{{ t('meetingMinutesForm.project') }}</th><th>{{ t('meetingMinutesForm.recommendations') }}</th><th>{{ t('meetingsUi.responsible') }}</th><th>{{ t('meetingMinutesForm.executionPeriod') }}</th><th>{{ t('meetingsUi.deadline') }}</th></tr></thead>
              <tbody>
                <tr v-if="!topicRows.length"><td colspan="7" class="text-muted">{{ t('meetingMinutesForm.noTopics') }}</td></tr>
                <tr v-for="row in topicRows" :key="`${row.topic.key}-${row.recommendation?.id ?? 'none'}`">
                  <td class="font-medium">{{ row.topic.title || t('meetingMinutesForm.untitledTopic') }}</td>
                  <td class="whitespace-pre-wrap">{{ row.topic.discussion || '—' }}</td>
                  <td>{{ row.topic.project_id ? t('meetingMinutesForm.projectId', { id: row.topic.project_id }) : '—' }}</td>
                  <td>{{ row.recommendation?.name || '—' }}</td>
                  <td>{{ row.recommendation?.responsible?.name || '—' }}</td>
                  <td>{{ row.recommendation?.execution_period || '—' }}</td>
                  <td dir="ltr">{{ formatMeetingDate(row.recommendation?.deadline, locale) }}</td>
                </tr>
                <tr v-for="item in unassignedRecommendations" :key="`unassigned-${item.id}`" class="text-muted">
                  <td>{{ t('meetingMinutesForm.unassigned') }}</td><td>—</td><td>{{ item.project?.name || '—' }}</td><td>{{ item.name }}</td><td>{{ item.responsible?.name || '—' }}</td><td>{{ item.execution_period || '—' }}</td><td dir="ltr">{{ formatMeetingDate(item.deadline, locale) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="grid gap-1"><h3 class="font-semibold text-highlighted">{{ t('meetingMinutesForm.closing') }}</h3><p class="whitespace-pre-wrap text-sm">{{ form.closing || '—' }}</p></div>
        <dl class="grid gap-3 border-t border-default pt-3 text-sm sm:grid-cols-3">
          <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.chairperson') }}</dt><dd>{{ form.chairperson || '—' }}</dd></div>
          <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.approverName') }}</dt><dd>{{ form.approver_name || '—' }}</dd></div>
          <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.approverTitle') }}</dt><dd>{{ form.approver_title || '—' }}</dd></div>
        </dl>
      </template>

      <template v-else>
        <section class="grid gap-2"><h3 class="font-semibold text-highlighted">{{ t('meetingsUi.agenda') }}</h3><p class="whitespace-pre-wrap text-sm">{{ legacyAgendaText || '—' }}</p></section>
        <section class="grid gap-2"><h3 class="font-semibold text-highlighted">{{ t('meetingsUi.minutes') }}</h3><p class="whitespace-pre-wrap text-sm">{{ legacyMinutesText || '—' }}</p></section>
        <section class="grid gap-2">
          <h3 class="font-semibold text-highlighted">{{ t('meetingsUi.resolutions') }}</h3>
          <div class="overflow-x-auto rounded-lg ring ring-default print:overflow-visible print:ring-0">
            <table class="meeting-minutes-topic-table min-w-[700px] w-full text-sm">
              <thead><tr><th>{{ t('meetingMinutesForm.recommendations') }}</th><th>{{ t('meetingsUi.responsible') }}</th><th>{{ t('meetingMinutesForm.executionPeriod') }}</th><th>{{ t('meetingsUi.deadline') }}</th></tr></thead>
              <tbody><tr v-if="!legacyRecommendations.length"><td colspan="4" class="text-muted">{{ t('meetingsUi.emptyResolutions') }}</td></tr><tr v-for="item in legacyRecommendations" :key="item.id"><td>{{ item.name }}</td><td>{{ item.responsible?.name || '—' }}</td><td>{{ item.execution_period || '—' }}</td><td dir="ltr">{{ formatMeetingDate(item.deadline, locale) }}</td></tr></tbody>
            </table>
          </div>
        </section>
      </template>
    </div>
  </UCard>
</template>
