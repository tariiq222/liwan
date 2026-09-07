<script setup lang="ts">
import { useCreateMeeting } from '@/composables/useMeetings'
import { usePeople } from '@/composables/usePeople'
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
const attendeeIds = ref<number[]>([])
const peopleQ = ref('')
const people = usePeople(peopleQ)
const { mutateAsync, isPending, error } = useCreateMeeting()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/meetings', ['/meetings']))
function snapshot() {
  return JSON.stringify([name.value, meetingDate.value, start.value, end.value, location.value,
    meetingUrl.value, [...attendeeIds.value].sort((a, b) => a - b)])
}
const baseline = ref(snapshot())
const dirty = computed(() => snapshot() !== baseline.value)

function toggleAttendee(userId: number) {
  attendeeIds.value = attendeeIds.value.includes(userId)
    ? attendeeIds.value.filter(id => id !== userId)
    : [...attendeeIds.value, userId]
}

async function save() {
  if (!hydrated.value || !can('meetings.create') || !name.value.trim()) return
  const meeting = await mutateAsync({
    name: name.value.trim(),
    meeting_date: meetingDate.value || undefined,
    start_datetime: start.value || undefined,
    end_datetime: end.value || undefined,
    location: location.value || undefined,
    meeting_url: meetingUrl.value || undefined,
    attendee_ids: attendeeIds.value,
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
      <fieldset class="grid gap-2">
        <legend class="text-sm">{{ t('meetingsUi.attendees') }}</legend>
        <label v-for="person in people.data.value ?? []" :key="person.user_id" class="flex items-center gap-2 text-sm">
          <input type="checkbox" :checked="attendeeIds.includes(person.user_id)" :disabled="!hydrated || isPending" @change="toggleAttendee(person.user_id)">
          {{ person.name }}
        </label>
      </fieldset>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error.message }}</p>
      <div class="flex justify-end gap-2">
        <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
        <Button type="submit" :disabled="!hydrated || isPending || !name.trim()">{{ t('app.create') }}</Button>
      </div>
    </form>
  </SharedPageContainer>
</template>
