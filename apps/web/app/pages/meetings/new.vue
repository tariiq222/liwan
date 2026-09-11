<script setup lang="ts">
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useCreateMeeting } from '@/composables/useMeetings'
import { useMeetingSeries } from '@/composables/useMeetings'
import { buildMeetingSchedulePayload } from '@/utils/meetingDateTime'
import { getMeetingFormErrors } from '@/utils/meetingForm'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const name = ref('')
const meetingDate = ref('')
const start = ref('')
const end = ref('')
const endDate = ref('')
const meetingDateField = computed({ get: () => meetingDate.value || null, set: value => { meetingDate.value = value || '' } })
const endDateField = computed({ get: () => endDate.value || null, set: value => { endDate.value = value || '' } })
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
function applySeriesDefaults(series: typeof seriesQuery.data.value) {
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
}
watch(seriesQuery.data, applySeriesDefaults, { immediate: true })
useSsrQuerySeed(seriesQuery, applySeriesDefaults)
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
    <form class="space-y-8" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <p v-if="context.series || context.project" class="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
        <span v-if="context.series">{{ t('meetingsUx.context.series', { name: context.series }) }}</span>
        <span v-if="context.series && context.project"> · </span>
        <span v-if="context.project">{{ t('meetingsUx.context.project', { name: context.project }) }}</span>
      </p>
      <SharedFormSection :title="t('meetingsUi.sectionSchedule')">
        <div class="nasq-form-grid">
          <UFormField class="sm:col-span-2" :label="t('meetingsUi.title')" name="name" required :error="formErrors.name ? t(`meetingsUx.errors.${formErrors.name}`) : undefined">
            <UInput id="meeting-name" v-model="name" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.name" required />
          </UFormField>
          <UFormField :label="t('meetingsUi.date')" name="date" required :error="formErrors.date ? t(`meetingsUx.errors.${formErrors.date}`) : undefined">
            <SharedDateField id="meeting-date" v-model="meetingDateField" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.date" aria-required="true" />
          </UFormField>
          <UFormField :label="t('meetingsUi.start')" name="start" :error="formErrors.start ? t(`meetingsUx.errors.${formErrors.start}`) : undefined">
            <UInput id="meeting-start" v-model="start" type="time" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.start" />
          </UFormField>
          <UFormField :label="t('meetingsUi.end')" name="end" :error="formErrors.end ? t(`meetingsUx.errors.${formErrors.end}`) : undefined">
            <UInput id="meeting-end" v-model="end" type="time" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.end" />
          </UFormField>
          <UFormField v-if="end" :label="t('meetingsUx.endDate')" name="endDate" :error="formErrors.endDate ? t(`meetingsUx.errors.${formErrors.endDate}`) : undefined">
            <SharedDateField id="meeting-end-date" v-model="endDateField" :min-value="meetingDate || null" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.endDate" />
          </UFormField>
          <UFormField :label="t('meetingsUi.location')" name="location">
            <UInput id="meeting-location" v-model="location" class="w-full" :disabled="!hydrated || isPending" />
          </UFormField>
          <UFormField class="sm:col-span-2" :label="t('meetingsUi.url')" name="meetingUrl" :error="formErrors.meetingUrl ? t(`meetingsUx.errors.${formErrors.meetingUrl}`) : undefined">
            <UInput id="meeting-url" v-model="meetingUrl" dir="ltr" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.meetingUrl" />
          </UFormField>
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.sectionPeople')">
        <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :known="seriesPeople" :disabled="!hydrated || isPending || seriesDefaultsLoading" />
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.agenda')">
        <ClientOnly>
          <DescriptionEditor :model-value="agenda" :task-id="0" :aria-label="t('meetingsUx.agendaLabel')" :readonly="isPending" @draft="agenda = $event.html" />
        </ClientOnly>
      </SharedFormSection>
      <UAlert v-if="seriesDefaultsError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUi.seriesDefaultsError')" />
      <UAlert v-else-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUx.errors.save')" />
      <div class="nasq-form-footer justify-end">
        <UButton type="button" color="secondary" :to="returnTo" :label="t('app.cancel')" />
        <UButton type="submit" :disabled="!hydrated || isPending || seriesDefaultsLoading || !!seriesDefaultsError || Object.keys(formErrors).length > 0" :label="t('app.create')" />
      </div>
    </form>
  </SharedPageContainer>
</template>
