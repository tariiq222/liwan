<script setup lang="ts">
import { owningListBack, recordParentTo } from '@/utils/recordListOrigin'
import { MEETING_LIST_PATHS } from '@/modules/meetings/navigation'
import DescriptionEditor from '@/components/shared/form/DescriptionEditor.vue'
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import type { MeetingPatch } from '@liwan/contracts'
import { useMeeting, usePatchMeeting } from '@/composables/useMeetings'
import { buildMeetingSchedulePayload, localDateFromUtc, localTimeFromUtc } from '@/utils/meetingDateTime'
import { getMeetingFormErrors } from '@/utils/meetingForm'
import { parsePositiveId } from '@/utils/routeParams'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'
import { ApiError } from '@/composables/useApi'

const route = useRoute()
const sourcePaths = useRecordListPaths(MEETING_LIST_PATHS)
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => parsePositiveId(route.params.id))
const query = useMeeting(id)
// An id that is not a canonical positive integer has no record to load and shows the same not-found state as an unknown id.
const pageError = computed(() => query.error.value ?? (id.value !== null ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const { mutateAsync, isPending, error, reset } = usePatchMeeting()
// Child pages always return to their current record; only normalized list context follows.
const backTo = computed(() => id.value === null ? owningListBack(route.query, sourcePaths.value, route.hash) : recordParentTo(`/meetings/${id.value}`, route.query, sourcePaths.value, route.hash))
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
const scope = ref<'this' | 'this_and_following'>('this')
const loaded = ref(false)
const baseline = ref('')
// The server revision the form opened on; a background refetch must not replace it, or a concurrent save would go unnoticed.
const openedWriteDate = ref<string | null>(null)
const initialSchedule = ref('')
function snapshot() {
  return JSON.stringify([name.value, meetingDate.value, start.value, end.value, endDate.value, location.value,
    meetingUrl.value, agenda.value, [...attendeeIds.value].sort((a, b) => a - b), secretaryId.value, scope.value])
}
function scheduleSnapshot() {
  return JSON.stringify([meetingDate.value, start.value, end.value, endDate.value])
}

function seedMeeting(meeting: typeof query.data.value) {
  if (!meeting || loaded.value) return
  name.value = meeting.name
  meetingDate.value = meeting.start_datetime ? localDateFromUtc(meeting.start_datetime) : meeting.meeting_date || ''
  start.value = localTimeFromUtc(meeting.start_datetime)
  end.value = localTimeFromUtc(meeting.end_datetime)
  endDate.value = localDateFromUtc(meeting.end_datetime)
  location.value = meeting.location
  meetingUrl.value = meeting.meeting_url
  agenda.value = meeting.agenda
  attendeeIds.value = meeting.attendees.map(person => person.id)
  secretaryId.value = meeting.secretary?.id ?? null
  baseline.value = snapshot()
  initialSchedule.value = scheduleSnapshot()
  openedWriteDate.value = meeting.write_date
  loaded.value = true
}
watch(query.data, seedMeeting, { immediate: true })
useSsrQuerySeed(query, seedMeeting)

const dirty = computed(() => loaded.value && snapshot() !== baseline.value)
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
const scheduleDirty = computed(() => loaded.value && scheduleSnapshot() !== initialSchedule.value)
const canEdit = computed(() => query.data.value?.can_edit === true)
const browserTimeZone = computed(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
const scheduleDate = computed(() => meetingDate.value)
const scheduleEndDate = computed(() => endDate.value || scheduleDate.value)
const startTime = computed(() => start.value.includes('T') ? start.value.slice(11, 16) : start.value)
const endTime = computed(() => end.value.includes('T') ? end.value.slice(11, 16) : end.value)
const formErrors = computed(() => getMeetingFormErrors({
  name: name.value,
  date: scheduleDate.value,
  start: startTime.value,
  end: endTime.value,
  endDate: scheduleEndDate.value,
  meetingUrl: meetingUrl.value,
}))
const context = computed(() => ({
  series: route.query.series_name ? String(route.query.series_name) : '',
  project: route.query.project_name ? String(route.query.project_name) : '',
}))
const known = computed(() => {
  const meeting = query.data.value
  if (!meeting) return []
  return [meeting.organizer, meeting.secretary, ...meeting.attendees].filter(Boolean) as { id: number; name: string }[]
})

const formElement = ref<HTMLFormElement | null>(null)
const { attemptedSubmit, visibleErrors, validate } = useMeetingFormFeedback(formErrors, formElement)

async function save() {
  if (id.value === null || !hydrated.value || isPending.value || !canEdit.value || !validate()) return
  const body: MeetingPatch = {
    name: name.value.trim(),
    location: location.value,
    meeting_url: meetingUrl.value,
    agenda: agenda.value,
    attendee_ids: attendeeIds.value,
    secretary_id: secretaryId.value,
    write_date: openedWriteDate.value ?? undefined,
    scope: query.data.value?.series_id ? scope.value : undefined,
  }
  if (scheduleDirty.value) Object.assign(body, buildMeetingSchedulePayload({ date: scheduleDate.value, start: startTime.value, end: endTime.value, endDate: scheduleEndDate.value, mode: 'patch' }))
  await mutateAsync({
    id: id.value,
    body,
  })
  baseline.value = snapshot()
  await nextTick()
  await navigateTo(backTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUi.edit')" :back-to="backTo" />
    <SharedPageState :loading="query.isLoading.value" :error="pageError" :empty="!query.isLoading.value && !pageError && !query.data.value" @retry="query.refetch">
      <form ref="formElement" novalidate v-if="query.data.value" class="grid gap-(--liwan-gap-card)" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <UAlert v-if="attemptedSubmit && Object.values(formErrors).filter(Boolean).length > 1" color="error" variant="subtle" role="alert" :title="t('meetingsUx.validationSummary', { count: Object.values(formErrors).filter(Boolean).length })" />
      <UAlert v-if="!canEdit" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUx.editForbidden')" />
      <UAlert v-if="context.series || context.project" color="neutral" variant="subtle" icon="i-lucide-info" :title="[context.series && t('meetingsUx.context.series', { name: context.series }), context.project && t('meetingsUx.context.project', { name: context.project })].filter(Boolean).join(' · ')" />
      <SharedFormSection panel :title="t('meetingsUi.sectionSchedule')" :description="t('meetingsUx.browserTimeZone', { zone: browserTimeZone })">
        <div class="liwan-form-grid">
          <UFormField class="sm:col-span-2" :label="t('meetingsUi.title')" name="name" required :error="serverErrors.name || (visibleErrors.name ? t(`meetingsUx.errors.${visibleErrors.name}`) : undefined)">
            <UInput id="edit-name" v-model="name" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!visibleErrors.name" required />
          </UFormField>
          <UFormField :label="t('meetingsUi.date')" name="date" required :error="serverErrors.date || (visibleErrors.date ? t(`meetingsUx.errors.${visibleErrors.date}`) : undefined)">
            <SharedDateField id="edit-date" v-model="meetingDateField" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!visibleErrors.date" aria-required="true" />
          </UFormField>
          <UFormField :label="t('meetingsUi.start')" name="start" :error="serverErrors.start || (visibleErrors.start ? t(`meetingsUx.errors.${visibleErrors.start}`) : undefined)">
            <UInput id="edit-start" v-model="start" type="time" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!visibleErrors.start" />
          </UFormField>
          <UFormField :label="t('meetingsUi.end')" name="end" :error="serverErrors.end || (visibleErrors.end ? t(`meetingsUx.errors.${visibleErrors.end}`) : undefined)">
            <UInput id="edit-end" v-model="end" type="time" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!visibleErrors.end" />
          </UFormField>
          <UFormField v-if="end" :label="t('meetingsUx.endDate')" name="endDate" :error="visibleErrors.endDate ? t(`meetingsUx.errors.${visibleErrors.endDate}`) : undefined">
            <SharedDateField id="edit-end-date" v-model="endDateField" :min-value="meetingDate || null" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!visibleErrors.endDate" />
          </UFormField>
          <UFormField :label="t('meetingsUi.location')" name="location" :error="serverErrors.location">
            <UInput id="edit-location" v-model="location" class="w-full" :disabled="!hydrated || isPending || !canEdit" />
          </UFormField>
          <UFormField class="sm:col-span-2" :label="t('meetingsUi.url')" name="meetingUrl" :error="serverErrors.meetingUrl || (visibleErrors.meetingUrl ? t(`meetingsUx.errors.${visibleErrors.meetingUrl}`) : undefined)">
            <UInput id="edit-url" v-model="meetingUrl" dir="ltr" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!visibleErrors.meetingUrl" />
          </UFormField>
          <UFormField v-if="query.data.value.series_id" :label="t('meetingsUi.scope')" name="scope">
            <USelect
              id="edit-scope"
              v-model="scope"
              class="w-full"
              :disabled="!hydrated || isPending || !canEdit"
              :items="[{ label: t('meetingsUi.scopeThis'), value: 'this' }, { label: t('meetingsUi.scopeFollowing'), value: 'this_and_following' }]"
            />
          </UFormField>
        </div>
      </SharedFormSection>
      <SharedFormSection panel :title="t('meetingsUi.sectionPeople')">
        <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :known="known" :attendees-error="serverErrors.attendees" :secretary-error="serverErrors.secretary" :disabled="!hydrated || isPending || !canEdit" />
      </SharedFormSection>
      <SharedFormSection panel :title="t('meetingsUi.agenda')">
        <ClientOnly>
          <DescriptionEditor :model-value="agenda" :task-id="query.data.value.id" :aria-label="t('meetingsUx.agendaLabel')" :readonly="isPending || !canEdit" @draft="agenda = $event.html" />
        </ClientOnly>
      </SharedFormSection>
      <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="submitError" />
      <SharedFormActions>
        <p class="me-auto text-xs text-muted">{{ t('meetingsUx.requiredHint') }}</p>
        <div class="flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
          <UButton type="submit" :disabled="!hydrated || isPending || !canEdit" :loading="isPending" :label="t('meetingsUx.saveChanges')" />
        </div>
      </SharedFormActions>
    </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
