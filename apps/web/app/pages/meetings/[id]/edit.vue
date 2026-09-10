<script setup lang="ts">
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import type { MeetingPatch } from '@nasq/contracts'
import { useMeeting, usePatchMeeting } from '@/composables/useMeetings'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { buildMeetingSchedulePayload, localDateFromUtc, localTimeFromUtc } from '@/utils/meetingDateTime'
import { getMeetingFormErrors } from '@/utils/meetingForm'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const query = useMeeting(id)
const { mutateAsync, isPending, error } = usePatchMeeting()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/meetings/${id.value}`, ['/meetings']))
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

watch(query.data, (meeting) => {
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
}, { immediate: true })

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
  await navigateTo(returnTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUi.edit')" :back-to="returnTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !query.data.value" @retry="query.refetch">
      <form v-if="query.data.value" class="nasq-form nasq-panel nasq-panel-body grid gap-5" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <p v-if="!canEdit" role="alert" class="text-sm text-destructive">{{ t('meetingsUx.editForbidden') }}</p>
        <p v-if="context.series || context.project" class="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
        <span v-if="context.series">{{ t('meetingsUx.context.series', { name: context.series }) }}</span>
        <span v-if="context.series && context.project"> · </span>
        <span v-if="context.project">{{ t('meetingsUx.context.project', { name: context.project }) }}</span>
        </p>
      <p class="text-xs text-muted-foreground">{{ t('meetingsUx.browserTimeZone', { zone: browserTimeZone }) }}</p>
      <SharedFormSection :title="t('meetingsUi.sectionSchedule')" class="grid gap-4">
        <div class="nasq-form-grid">
          <div class="grid gap-2 sm:col-span-2">
            <Label for="edit-name">{{ t('meetingsUi.title') }}</Label>
            <Input id="edit-name" v-model="name" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.name" aria-describedby="edit-name-error" required />
            <p v-if="formErrors.name" id="edit-name-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.name}`) }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="edit-date">{{ t('meetingsUi.date') }}</Label>
            <Input id="edit-date" v-model="meetingDate" type="date" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.date" aria-describedby="edit-date-error" required />
            <p v-if="formErrors.date" id="edit-date-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.date}`) }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="edit-start">{{ t('meetingsUi.start') }}</Label>
            <Input id="edit-start" v-model="start" type="time" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.start" aria-describedby="edit-start-error" />
            <p v-if="formErrors.start" id="edit-start-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.start}`) }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="edit-end">{{ t('meetingsUi.end') }}</Label>
            <Input id="edit-end" v-model="end" type="time" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.end" aria-describedby="edit-end-error" />
            <p v-if="formErrors.end" id="edit-end-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.end}`) }}</p>
          </div>
          <template v-if="end">
            <div class="grid gap-2">
              <Label for="edit-end-date">{{ t('meetingsUx.endDate') }}</Label>
              <Input id="edit-end-date" v-model="endDate" type="date" :min="meetingDate" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.endDate" aria-describedby="edit-end-date-error" />
              <p v-if="formErrors.endDate" id="edit-end-date-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.endDate}`) }}</p>
            </div>
          </template>
          <div class="grid gap-2">
            <Label for="edit-location">{{ t('meetingsUi.location') }}</Label>
            <Input id="edit-location" v-model="location" :disabled="!hydrated || isPending || !canEdit" />
          </div>
          <div class="grid gap-2 sm:col-span-2">
            <Label for="edit-url">{{ t('meetingsUi.url') }}</Label>
            <Input id="edit-url" v-model="meetingUrl" dir="ltr" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.meetingUrl" aria-describedby="edit-url-error" />
            <p v-if="formErrors.meetingUrl" id="edit-url-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.meetingUrl}`) }}</p>
          </div>
          <div v-if="query.data.value.series_id" class="grid gap-2">
            <Label for="edit-scope">{{ t('meetingsUi.scope') }}</Label>
            <select id="edit-scope" v-model="scope" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending || !canEdit">
              <option value="this">{{ t('meetingsUi.scopeThis') }}</option>
              <option value="this_and_following">{{ t('meetingsUi.scopeFollowing') }}</option>
            </select>
          </div>
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.sectionPeople')" class="grid gap-4">
        <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :known="known" :disabled="!hydrated || isPending || !canEdit" />
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.agenda')" class="grid gap-4">
        <ClientOnly>
          <DescriptionEditor :model-value="agenda" :task-id="id" :aria-label="t('meetingsUx.agendaLabel')" :readonly="isPending || !canEdit" @draft="agenda = $event.html" />
        </ClientOnly>
      </SharedFormSection>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ t('meetingsUx.errors.save') }}</p>
      <div class="nasq-form-footer justify-end">
        <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
        <Button type="submit" :disabled="!hydrated || isPending || !canEdit || Object.keys(formErrors).length > 0">{{ t('app.save') }}</Button>
      </div>
    </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
