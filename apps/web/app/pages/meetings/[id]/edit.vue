<script setup lang="ts">
import { recordParentTo, MEETING_LIST_PATHS } from '@/utils/recordListOrigin'
import DescriptionEditor from '@/components/shared/form/DescriptionEditor.vue'
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import type { MeetingPatch } from '@nasq/contracts'
import { useMeeting, usePatchMeeting } from '@/composables/useMeetings'
import { buildMeetingSchedulePayload, localDateFromUtc, localTimeFromUtc } from '@/utils/meetingDateTime'
import { getMeetingFormErrors } from '@/utils/meetingForm'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const query = useMeeting(id)
const { mutateAsync, isPending, error } = usePatchMeeting()
// Child pages always return to their current record; only normalized list context follows.
const backTo = computed(() => recordParentTo(`/meetings/${id.value}`, route.query, MEETING_LIST_PATHS, route.hash))
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
  loaded.value = true
}
watch(query.data, seedMeeting, { immediate: true })
useSsrQuerySeed(query, seedMeeting)

const dirty = computed(() => loaded.value && snapshot() !== baseline.value)
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

async function save() {
  if (!hydrated.value || isPending.value || !canEdit.value || Object.keys(formErrors.value).length) return
  const body: MeetingPatch = {
    name: name.value.trim(),
    location: location.value,
    meeting_url: meetingUrl.value,
    agenda: agenda.value,
    attendee_ids: attendeeIds.value,
    secretary_id: secretaryId.value,
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
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !query.data.value" @retry="query.refetch">
      <form v-if="query.data.value" class="space-y-8" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <UAlert v-if="!canEdit" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUx.editForbidden')" />
        <p v-if="context.series || context.project" class="rounded-lg bg-elevated/50 px-3 py-2 text-sm ring ring-default">
        <span v-if="context.series">{{ t('meetingsUx.context.series', { name: context.series }) }}</span>
        <span v-if="context.series && context.project"> · </span>
        <span v-if="context.project">{{ t('meetingsUx.context.project', { name: context.project }) }}</span>
        </p>
      <p class="text-xs text-muted">{{ t('meetingsUx.browserTimeZone', { zone: browserTimeZone }) }}</p>
      <SharedFormSection :title="t('meetingsUi.sectionSchedule')">
        <div class="nasq-form-grid">
          <UFormField class="sm:col-span-2" :label="t('meetingsUi.title')" name="name" required :error="formErrors.name ? t(`meetingsUx.errors.${formErrors.name}`) : undefined">
            <UInput id="edit-name" v-model="name" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.name" required />
          </UFormField>
          <UFormField :label="t('meetingsUi.date')" name="date" required :error="formErrors.date ? t(`meetingsUx.errors.${formErrors.date}`) : undefined">
            <SharedDateField id="edit-date" v-model="meetingDateField" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.date" aria-required="true" />
          </UFormField>
          <UFormField :label="t('meetingsUi.start')" name="start" :error="formErrors.start ? t(`meetingsUx.errors.${formErrors.start}`) : undefined">
            <UInput id="edit-start" v-model="start" type="time" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.start" />
          </UFormField>
          <UFormField :label="t('meetingsUi.end')" name="end" :error="formErrors.end ? t(`meetingsUx.errors.${formErrors.end}`) : undefined">
            <UInput id="edit-end" v-model="end" type="time" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.end" />
          </UFormField>
          <UFormField v-if="end" :label="t('meetingsUx.endDate')" name="endDate" :error="formErrors.endDate ? t(`meetingsUx.errors.${formErrors.endDate}`) : undefined">
            <SharedDateField id="edit-end-date" v-model="endDateField" :min-value="meetingDate || null" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.endDate" />
          </UFormField>
          <UFormField :label="t('meetingsUi.location')" name="location">
            <UInput id="edit-location" v-model="location" class="w-full" :disabled="!hydrated || isPending || !canEdit" />
          </UFormField>
          <UFormField class="sm:col-span-2" :label="t('meetingsUi.url')" name="meetingUrl" :error="formErrors.meetingUrl ? t(`meetingsUx.errors.${formErrors.meetingUrl}`) : undefined">
            <UInput id="edit-url" v-model="meetingUrl" dir="ltr" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.meetingUrl" />
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
      <SharedFormSection :title="t('meetingsUi.sectionPeople')">
        <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :known="known" :disabled="!hydrated || isPending || !canEdit" />
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.agenda')">
        <ClientOnly>
          <DescriptionEditor :model-value="agenda" :task-id="id" :aria-label="t('meetingsUx.agendaLabel')" :readonly="isPending || !canEdit" @draft="agenda = $event.html" />
        </ClientOnly>
      </SharedFormSection>
      <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUx.errors.save')" />
      <div class="nasq-form-footer justify-end">
        <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" :disabled="!hydrated || isPending || !canEdit || Object.keys(formErrors).length > 0" :label="t('app.save')" />
      </div>
    </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
