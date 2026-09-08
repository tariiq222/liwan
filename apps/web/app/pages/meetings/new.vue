<script setup lang="ts">
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useCreateMeeting } from '@/composables/useMeetings'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const name = ref('')
const meetingDate = ref('')
const start = ref('')
const end = ref('')
const location = ref('')
const meetingUrl = ref('')
const agenda = ref('')
const attendeeIds = ref<number[]>([])
const secretaryId = ref<number | null>(null)
const { mutateAsync, isPending, error } = useCreateMeeting()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/meetings', ['/meetings']))
function snapshot() {
  return JSON.stringify([name.value, meetingDate.value, start.value, end.value, location.value,
    meetingUrl.value, agenda.value, [...attendeeIds.value].sort((a, b) => a - b), secretaryId.value])
}
const baseline = ref(snapshot())
const dirty = computed(() => snapshot() !== baseline.value)

async function save() {
  if (!hydrated.value || !can('meetings.create') || !name.value.trim()) return
  const meeting = await mutateAsync({
    name: name.value.trim(),
    meeting_date: meetingDate.value || undefined,
    start_datetime: start.value || undefined,
    end_datetime: end.value || undefined,
    location: location.value || undefined,
    meeting_url: meetingUrl.value || undefined,
    agenda: agenda.value || undefined,
    attendee_ids: attendeeIds.value,
    secretary_id: secretaryId.value || undefined,
    series_id: route.query.series_id ? Number(route.query.series_id) : undefined,
    project_id: route.query.project_id ? Number(route.query.project_id) : undefined,
  })
  baseline.value = snapshot()
  await nextTick()
  await navigateTo({ path: `/meetings/${meeting.id}`, query: returnToQuery(returnTo.value) })
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUi.new')" :back-to="returnTo" />
    <form class="nasq-form nasq-panel nasq-panel-body grid gap-4" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedFormSection :title="t('meetingsUi.sectionSchedule')">
        <Label for="meeting-name">{{ t('meetingsUi.title') }}</Label>
        <Input id="meeting-name" v-model="name" :disabled="!hydrated || isPending" required />
        <Label for="meeting-date">{{ t('meetingsUi.date') }}</Label>
        <Input id="meeting-date" v-model="meetingDate" type="date" :disabled="!hydrated || isPending" />
        <Label for="meeting-start">{{ t('meetingsUi.start') }}</Label>
        <Input id="meeting-start" v-model="start" type="datetime-local" :disabled="!hydrated || isPending" />
        <Label for="meeting-end">{{ t('meetingsUi.end') }}</Label>
        <Input id="meeting-end" v-model="end" type="datetime-local" :disabled="!hydrated || isPending" />
        <Label for="meeting-location">{{ t('meetingsUi.location') }}</Label>
        <Input id="meeting-location" v-model="location" :disabled="!hydrated || isPending" />
        <Label for="meeting-url">{{ t('meetingsUi.url') }}</Label>
        <Input id="meeting-url" v-model="meetingUrl" dir="ltr" :disabled="!hydrated || isPending" />
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.sectionPeople')">
        <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :disabled="!hydrated || isPending" />
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.agenda')">
        <ClientOnly>
          <DescriptionEditor :model-value="agenda" :task-id="0" :readonly="isPending" @draft="agenda = $event.html" />
        </ClientOnly>
      </SharedFormSection>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error.message }}</p>
      <div class="flex justify-end gap-2">
        <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
        <Button type="submit" :disabled="!hydrated || isPending || !name.trim()">{{ t('app.create') }}</Button>
      </div>
    </form>
  </SharedPageContainer>
</template>
