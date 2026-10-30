<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { MEETING_LIST_PATHS } from '@/modules/meetings/navigation'
import DescriptionEditor from '@/components/shared/form/DescriptionEditor.vue'
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useCreateMeeting } from '@/composables/useMeetings'
import { useMeetingSeries } from '@/composables/useMeetings'
import { buildMeetingSchedulePayload } from '@/utils/meetingDateTime'
import { localIsoDay } from '@liwan/ui/app/utils/formatDate'
import { isCalendarDate } from '@liwan/ui/app/composables/calendarDate'
import { firstQuery } from '@/utils/routeQuery'
import { getMeetingFormErrors } from '@/utils/meetingForm'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const name = ref('')
const initialDate = firstQuery(route.query.date) ?? ''
const meetingDate = ref(isCalendarDate(initialDate) ? initialDate : '')
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
const { mutateAsync, isPending, error, reset } = useCreateMeeting()
const sourcePaths = useRecordListPaths(MEETING_LIST_PATHS)
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const seriesId = computed(() => {
  const value = Number(route.query.series_id)
  return Number.isInteger(value) && value > 0 ? value : null
})
const projectId = computed(() => {
  const value = Number(route.query.project_id)
  return Number.isInteger(value) && value > 0 ? value : undefined
})
const browserTimeZone = computed(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
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
const { fieldErrors: serverErrors, submitError } = useMeetingSubmitError({
  error,
  reset,
  edits: snapshot,
  fields: {
    name: 'name',
    meeting_date: 'date',
    start_datetime: 'start',
    end_datetime: 'end',
    location: 'location',
    meeting_url: 'meetingUrl',
    secretary_id: 'secretary',
    attendee_ids: 'attendees',
  },
})
const context = computed(() => ({
  series: seriesId.value ? String(route.query.series_name || seriesId.value) : '',
  project: projectId.value ? String(route.query.project_name || projectId.value) : '',
}))
// The date is optional: left empty the meeting is for today, as the API defaults it.
const scheduleDate = computed(() => meetingDate.value || (/^\d{4}-\d{2}-\d{2}T/.test(start.value) ? start.value.slice(0, 10) : /^\d{4}-\d{2}-\d{2}T/.test(end.value) ? end.value.slice(0, 10) : localIsoDay(new Date())))
const scheduleEndDate = computed(() => endDate.value || (/^\d{4}-\d{2}-\d{2}T/.test(end.value) ? end.value.slice(0, 10) : ''))
// Validation starts after the first save attempt: an untouched form must not
// open covered in "required" errors.
const formErrors = computed(() => getMeetingFormErrors({
  name: name.value,
  date: scheduleDate.value,
  start: start.value.includes('T') ? start.value.slice(11, 16) : start.value,
  end: end.value.includes('T') ? end.value.slice(11, 16) : end.value,
  endDate: scheduleEndDate.value,
  meetingUrl: meetingUrl.value,
}))
const formElement = ref<HTMLFormElement | null>(null)
const { attemptedSubmit, visibleErrors, validate } = useMeetingFormFeedback(formErrors, formElement)

async function save() {
  if (!hydrated.value || isPending.value || !can('meetings.create') || !validate() || seriesDefaultsLoading.value || seriesDefaultsError.value) return
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
  await navigateTo({ path: `/meetings/${meeting.id}`, query: { returnTo: router.resolve(backTo.value).fullPath } }, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t('meetingsUi.new')" :back-to="backTo">
    <form ref="formElement" novalidate class="grid gap-(--liwan-gap-card)" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <UAlert v-if="attemptedSubmit && Object.values(formErrors).filter(Boolean).length > 1" color="error" variant="subtle" role="alert" :title="t('meetingsUx.validationSummary', { count: Object.values(formErrors).filter(Boolean).length })" />
      <UAlert v-if="context.series || context.project" color="neutral" variant="subtle" icon="i-lucide-info" :title="[context.series && t('meetingsUx.context.series', { name: context.series }), context.project && t('meetingsUx.context.project', { name: context.project })].filter(Boolean).join(' · ')" />
      <SharedFormSection panel :title="t('meetingsUi.sectionSchedule')" :description="t('meetingsUx.browserTimeZone', { zone: browserTimeZone })">
        <div class="liwan-form-grid">
          <UFormField class="sm:col-span-2" :label="t('meetingsUi.title')" name="name" required :error="serverErrors.name || (visibleErrors.name ? t(`meetingsUx.errors.${visibleErrors.name}`) : undefined)">
            <UInput id="meeting-name" v-model="name" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.name" required />
          </UFormField>
          <UFormField :label="t('meetingsUi.date')" name="date" :error="serverErrors.date || (visibleErrors.date ? t(`meetingsUx.errors.${visibleErrors.date}`) : undefined)">
            <SharedDateField id="meeting-date" v-model="meetingDateField" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.date" />
          </UFormField>
          <UFormField :label="t('meetingsUi.start')" name="start" :error="serverErrors.start || (visibleErrors.start ? t(`meetingsUx.errors.${visibleErrors.start}`) : undefined)">
            <UInput id="meeting-start" v-model="start" type="time" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.start" />
          </UFormField>
          <UFormField :label="t('meetingsUi.end')" name="end" :error="serverErrors.end || (visibleErrors.end ? t(`meetingsUx.errors.${visibleErrors.end}`) : undefined)">
            <UInput id="meeting-end" v-model="end" type="time" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.end" />
          </UFormField>
          <UFormField v-if="end" :label="t('meetingsUx.endDate')" name="endDate" :error="visibleErrors.endDate ? t(`meetingsUx.errors.${visibleErrors.endDate}`) : undefined">
            <SharedDateField id="meeting-end-date" v-model="endDateField" :min-value="meetingDate || null" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.endDate" />
          </UFormField>
          <UFormField :label="t('meetingsUi.location')" name="location" :error="serverErrors.location">
            <UInput id="meeting-location" v-model="location" class="w-full" :disabled="!hydrated || isPending" />
          </UFormField>
          <UFormField class="sm:col-span-2" :label="t('meetingsUi.url')" name="meetingUrl" :error="serverErrors.meetingUrl || (visibleErrors.meetingUrl ? t(`meetingsUx.errors.${visibleErrors.meetingUrl}`) : undefined)">
            <UInput id="meeting-url" v-model="meetingUrl" dir="ltr" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.meetingUrl" />
          </UFormField>
        </div>
      </SharedFormSection>
      <SharedFormSection panel :title="t('meetingsUi.sectionPeople')">
        <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :known="seriesPeople" :attendees-error="serverErrors.attendees" :secretary-error="serverErrors.secretary" :disabled="!hydrated || isPending || seriesDefaultsLoading" />
      </SharedFormSection>
      <SharedFormSection panel :title="t('meetingsUi.agenda')">
        <ClientOnly>
          <DescriptionEditor :model-value="agenda" :task-id="0" :aria-label="t('meetingsUx.agendaLabel')" :readonly="isPending" @draft="agenda = $event.html" />
        </ClientOnly>
      </SharedFormSection>
      <UAlert v-if="seriesDefaultsError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUi.seriesDefaultsError')" />
      <UAlert v-else-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="submitError" />
      <SharedFormActions>
        <p class="me-auto text-xs text-muted">{{ t('meetingsUx.requiredHint') }}</p>
        <div class="flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
          <UButton type="submit" :disabled="!hydrated || isPending || seriesDefaultsLoading || !!seriesDefaultsError" :loading="isPending" :label="t('meetingsUx.createMeeting')" />
        </div>
      </SharedFormActions>
    </form>
  </SharedCreatePanel>
</template>
