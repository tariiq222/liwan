<script setup lang="ts">
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useCreateMeeting } from '@/composables/useMeetings'
import { useMeetingSeries } from '@/composables/useMeetings'
import { buildMeetingSchedulePayload } from '@/utils/meetingDateTime'
import { getMeetingFormErrors } from '@/utils/meetingForm'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const name = ref('')
const meetingDate = ref('')
const start = ref('')
const end = ref('')
const endDate = ref('')
const location = ref('')
const meetingUrl = ref('')
const agenda = ref('')
const attendeeIds = ref<number[]>([])
const secretaryId = ref<number | null>(null)
const { mutateAsync, isPending, error } = useCreateMeeting()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/meetings', ['/meetings']))
const seriesId = computed(() => {
  const value = Number(route.query.series_id)
  return Number.isInteger(value) && value > 0 ? value : null
})
const projectId = computed(() => {
  const value = Number(route.query.project_id)
  return Number.isInteger(value) && value > 0 ? value : undefined
})
const seriesQuery = useMeetingSeries(seriesId)
const seriesDefaultsApplied = ref(false)
const applyingSeriesDefaults = ref(false)
const attendeesTouched = ref(false)
const secretaryTouched = ref(false)
const locationTouched = ref(false)
const meetingUrlTouched = ref(false)
const seriesDefaultsError = computed(() => seriesId.value && seriesQuery.error.value ? seriesQuery.error.value : null)
const seriesDefaultsLoading = computed(() => Boolean(seriesId.value && seriesQuery.isLoading.value))
function snapshot() {
  return JSON.stringify([name.value, meetingDate.value, start.value, end.value, endDate.value, location.value,
    meetingUrl.value, agenda.value, [...attendeeIds.value].sort((a, b) => a - b), secretaryId.value])
}
const baseline = ref(snapshot())
const seriesPeople = computed(() => {
  const series = seriesQuery.data.value
  return series ? [...series.attendees, ...(series.secretary ? [series.secretary] : [])] : []
})
watch(attendeeIds, () => {
  if (applyingSeriesDefaults.value) return
  attendeesTouched.value = true
}, { deep: true })
watch(secretaryId, () => {
  if (applyingSeriesDefaults.value) return
  secretaryTouched.value = true
})
watch(location, () => {
  if (applyingSeriesDefaults.value) return
  locationTouched.value = true
}, { flush: 'sync' })
watch(meetingUrl, () => {
  if (applyingSeriesDefaults.value) return
  meetingUrlTouched.value = true
}, { flush: 'sync' })
watch(seriesQuery.data, (series) => {
  if (!series || seriesDefaultsApplied.value) return
  const wasDirty = snapshot() !== baseline.value
  applyingSeriesDefaults.value = true
  if (!attendeesTouched.value && !attendeeIds.value.length) attendeeIds.value = series.attendees.map(person => person.id)
  if (!secretaryTouched.value && secretaryId.value === null) secretaryId.value = series.secretary?.id ?? null
  if (!locationTouched.value && !location.value) location.value = series.location || ''
  if (!meetingUrlTouched.value && !meetingUrl.value) meetingUrl.value = series.meeting_url || ''
  applyingSeriesDefaults.value = false
  seriesDefaultsApplied.value = true
  if (!wasDirty) baseline.value = snapshot()
}, { immediate: true })
const dirty = computed(() => snapshot() !== baseline.value)
const context = computed(() => ({
  series: seriesId.value ? String(route.query.series_name || seriesId.value) : '',
  project: projectId.value ? String(route.query.project_name || projectId.value) : '',
}))
const scheduleDate = computed(() => meetingDate.value || (/^\d{4}-\d{2}-\d{2}T/.test(start.value) ? start.value.slice(0, 10) : /^\d{4}-\d{2}-\d{2}T/.test(end.value) ? end.value.slice(0, 10) : ''))
const scheduleEndDate = computed(() => endDate.value || (/^\d{4}-\d{2}-\d{2}T/.test(end.value) ? end.value.slice(0, 10) : ''))
const formErrors = computed(() => getMeetingFormErrors({
  name: name.value,
  date: scheduleDate.value,
  start: start.value.includes('T') ? start.value.slice(11, 16) : start.value,
  end: end.value.includes('T') ? end.value.slice(11, 16) : end.value,
  endDate: scheduleEndDate.value,
  meetingUrl: meetingUrl.value,
}))

async function save() {
  if (!hydrated.value || !can('meetings.create') || Object.keys(formErrors.value).length || seriesDefaultsLoading.value || seriesDefaultsError.value) return
  const schedule = buildMeetingSchedulePayload({
    date: scheduleDate.value,
    start: start.value.includes('T') ? start.value.slice(11, 16) : start.value,
    end: end.value.includes('T') ? end.value.slice(11, 16) : end.value,
    endDate: scheduleEndDate.value,
    mode: 'create',
  })
  const meeting = await mutateAsync({
    name: name.value.trim(),
    ...schedule,
    location: seriesId.value ? location.value : location.value || undefined,
    meeting_url: seriesId.value ? meetingUrl.value : meetingUrl.value || undefined,
    agenda: agenda.value || undefined,
    attendee_ids: attendeeIds.value,
    secretary_id: seriesId.value ? secretaryId.value : secretaryId.value || undefined,
    series_id: seriesId.value || undefined,
    project_id: projectId.value,
  })
  baseline.value = snapshot()
  await nextTick()
  await navigateTo({ path: `/meetings/${meeting.id}`, query: returnToQuery(returnTo.value) })
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUi.new')" :back-to="returnTo" />
    <form class="nasq-form nasq-panel nasq-panel-body grid gap-5" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <p v-if="context.series || context.project" class="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
        <span v-if="context.series">{{ t('meetingsUx.context.series', { name: context.series }) }}</span>
        <span v-if="context.series && context.project"> · </span>
        <span v-if="context.project">{{ t('meetingsUx.context.project', { name: context.project }) }}</span>
      </p>
      <SharedFormSection :title="t('meetingsUi.sectionSchedule')" class="grid gap-4">
        <div class="nasq-form-grid">
          <div class="grid gap-2 sm:col-span-2">
            <Label for="meeting-name">{{ t('meetingsUi.title') }}</Label>
            <Input id="meeting-name" v-model="name" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.name" aria-describedby="meeting-name-error" required />
            <p v-if="formErrors.name" id="meeting-name-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.name}`) }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="meeting-date">{{ t('meetingsUi.date') }}</Label>
            <Input id="meeting-date" v-model="meetingDate" type="date" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.date" aria-describedby="meeting-date-error" required />
            <p v-if="formErrors.date" id="meeting-date-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.date}`) }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="meeting-start">{{ t('meetingsUi.start') }}</Label>
            <Input id="meeting-start" v-model="start" type="time" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.start" aria-describedby="meeting-start-error" />
            <p v-if="formErrors.start" id="meeting-start-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.start}`) }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="meeting-end">{{ t('meetingsUi.end') }}</Label>
            <Input id="meeting-end" v-model="end" type="time" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.end" aria-describedby="meeting-end-error" />
            <p v-if="formErrors.end" id="meeting-end-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.end}`) }}</p>
          </div>
          <template v-if="end">
            <div class="grid gap-2">
              <Label for="meeting-end-date">{{ t('meetingsUx.endDate') }}</Label>
              <Input id="meeting-end-date" v-model="endDate" type="date" :min="meetingDate" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.endDate" aria-describedby="meeting-end-date-error" />
              <p v-if="formErrors.endDate" id="meeting-end-date-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.endDate}`) }}</p>
            </div>
          </template>
          <div class="grid gap-2">
            <Label for="meeting-location">{{ t('meetingsUi.location') }}</Label>
            <Input id="meeting-location" v-model="location" :disabled="!hydrated || isPending" />
          </div>
          <div class="grid gap-2 sm:col-span-2">
            <Label for="meeting-url">{{ t('meetingsUi.url') }}</Label>
            <Input id="meeting-url" v-model="meetingUrl" dir="ltr" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.meetingUrl" aria-describedby="meeting-url-error" />
            <p v-if="formErrors.meetingUrl" id="meeting-url-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.meetingUrl}`) }}</p>
          </div>
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.sectionPeople')" class="grid gap-4">
        <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :known="seriesPeople" :disabled="!hydrated || isPending || seriesDefaultsLoading" />
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.agenda')" class="grid gap-4">
        <ClientOnly>
          <DescriptionEditor :model-value="agenda" :task-id="0" :aria-label="t('meetingsUx.agendaLabel')" :readonly="isPending" @draft="agenda = $event.html" />
        </ClientOnly>
      </SharedFormSection>
      <p v-if="seriesDefaultsError" role="alert" class="text-sm text-destructive">{{ t('meetingsUi.seriesDefaultsError') }}</p>
      <p v-else-if="error" role="alert" class="text-sm text-destructive">{{ t('meetingsUx.errors.save') }}</p>
      <div class="nasq-form-footer justify-end">
        <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
        <Button type="submit" :disabled="!hydrated || isPending || seriesDefaultsLoading || !!seriesDefaultsError || Object.keys(formErrors).length > 0">{{ t('app.create') }}</Button>
      </div>
    </form>
  </SharedPageContainer>
</template>
