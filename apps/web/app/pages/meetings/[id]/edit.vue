<script setup lang="ts">
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useMeeting, usePatchMeeting } from '@/composables/useMeetings'
import { safeReturnTo } from '@/utils/safeReturnTo'

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
const location = ref('')
const meetingUrl = ref('')
const agenda = ref('')
const minutes = ref('')
const attendeeIds = ref<number[]>([])
const secretaryId = ref<number | null>(null)
const scope = ref<'this' | 'this_and_following'>('this')
const loaded = ref(false)
const baseline = ref('')
function snapshot() {
  return JSON.stringify([name.value, meetingDate.value, start.value, end.value, location.value,
    meetingUrl.value, agenda.value, minutes.value, [...attendeeIds.value].sort((a, b) => a - b), secretaryId.value, scope.value])
}

watch(query.data, (meeting) => {
  if (!meeting || loaded.value) return
  name.value = meeting.name
  meetingDate.value = meeting.meeting_date || ''
  start.value = meeting.start_datetime?.slice(0, 16) || ''
  end.value = meeting.end_datetime?.slice(0, 16) || ''
  location.value = meeting.location
  meetingUrl.value = meeting.meeting_url
  agenda.value = meeting.agenda
  minutes.value = meeting.minutes
  attendeeIds.value = meeting.attendees.map(person => person.id)
  secretaryId.value = meeting.secretary?.id ?? null
  baseline.value = snapshot()
  loaded.value = true
}, { immediate: true })

const dirty = computed(() => loaded.value && snapshot() !== baseline.value)
const known = computed(() => {
  const meeting = query.data.value
  if (!meeting) return []
  return [meeting.organizer, meeting.secretary, ...meeting.attendees].filter(Boolean) as { id: number; name: string }[]
})

async function save() {
  if (!hydrated.value || !name.value.trim()) return
  await mutateAsync({
    id: id.value,
    body: {
      name: name.value.trim(),
      meeting_date: meetingDate.value || undefined,
      start_datetime: start.value || undefined,
      end_datetime: end.value || undefined,
      location: location.value,
      meeting_url: meetingUrl.value,
      agenda: agenda.value,
      minutes: minutes.value,
      attendee_ids: attendeeIds.value,
      secretary_id: secretaryId.value,
      scope: query.data.value?.series_id ? scope.value : undefined,
    },
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
    <form v-if="query.data.value" class="nasq-form nasq-panel nasq-panel-body grid gap-4" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedFormSection :title="t('meetingsUi.sectionSchedule')">
        <Label for="edit-name">{{ t('meetingsUi.title') }}</Label>
        <Input id="edit-name" v-model="name" :disabled="!hydrated || isPending" required />
        <Label for="edit-date">{{ t('meetingsUi.date') }}</Label>
        <Input id="edit-date" v-model="meetingDate" type="date" :disabled="!hydrated || isPending" />
        <Label for="edit-start">{{ t('meetingsUi.start') }}</Label>
        <Input id="edit-start" v-model="start" type="datetime-local" :disabled="!hydrated || isPending" />
        <Label for="edit-end">{{ t('meetingsUi.end') }}</Label>
        <Input id="edit-end" v-model="end" type="datetime-local" :disabled="!hydrated || isPending" />
        <Label for="edit-location">{{ t('meetingsUi.location') }}</Label>
        <Input id="edit-location" v-model="location" :disabled="!hydrated || isPending" />
        <Label for="edit-url">{{ t('meetingsUi.url') }}</Label>
        <Input id="edit-url" v-model="meetingUrl" dir="ltr" :disabled="!hydrated || isPending" />
        <template v-if="query.data.value.series_id">
          <Label for="edit-scope">{{ t('meetingsUi.scope') }}</Label>
          <select id="edit-scope" v-model="scope" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending">
            <option value="this">{{ t('meetingsUi.scopeThis') }}</option>
            <option value="this_and_following">{{ t('meetingsUi.scopeFollowing') }}</option>
          </select>
        </template>
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.sectionPeople')">
        <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :known="known" :disabled="!hydrated || isPending" />
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.agenda')">
        <ClientOnly>
          <DescriptionEditor :model-value="agenda" :task-id="id" :readonly="isPending" @draft="agenda = $event.html" />
        </ClientOnly>
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.minutes')">
        <ClientOnly>
          <DescriptionEditor :model-value="minutes" :task-id="-id" :readonly="isPending" @draft="minutes = $event.html" />
        </ClientOnly>
      </SharedFormSection>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error.message }}</p>
      <div class="flex justify-end gap-2">
        <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
        <Button type="submit" :disabled="!hydrated || isPending">{{ t('app.save') }}</Button>
      </div>
    </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
