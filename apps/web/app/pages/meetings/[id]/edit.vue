<script setup lang="ts">
import { useMeeting, usePatchMeeting } from '@/composables/useMeetings'
import { usePeople } from '@/composables/usePeople'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const query = useMeeting(id)
const peopleQ = ref('')
const people = usePeople(peopleQ)
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
const loaded = ref(false)

watch(query.data, (meeting) => {
  if (!meeting || loaded.value) return
  name.value = meeting.name
  meetingDate.value = meeting.meeting_date || ''
  start.value = meeting.start_datetime?.slice(0, 16) || ''
  end.value = meeting.end_datetime?.slice(0, 16) || ''
  location.value = meeting.location
  meetingUrl.value = meeting.meeting_url
  agenda.value = meeting.agenda.replace(/<[^>]+>/g, '')
  minutes.value = meeting.minutes.replace(/<[^>]+>/g, '')
  attendeeIds.value = meeting.attendees.map(person => person.id)
  loaded.value = true
}, { immediate: true })

const dirty = computed(() => loaded.value)

function toggleAttendee(userId: number) {
  attendeeIds.value = attendeeIds.value.includes(userId)
    ? attendeeIds.value.filter(id => id !== userId)
    : [...attendeeIds.value, userId]
}

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
    },
  })
  await navigateTo(returnTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUi.edit')" :back-to="returnTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value" @retry="query.refetch" />
    <form v-if="query.data.value" class="nasq-form nasq-panel nasq-panel-body grid gap-4" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
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
      <Label for="edit-agenda">{{ t('meetingsUi.agenda') }}</Label>
      <textarea id="edit-agenda" v-model="agenda" class="border-input min-h-24 rounded-lg border bg-transparent p-3 text-sm" :disabled="!hydrated || isPending" />
      <Label for="edit-minutes">{{ t('meetingsUi.minutes') }}</Label>
      <textarea id="edit-minutes" v-model="minutes" class="border-input min-h-24 rounded-lg border bg-transparent p-3 text-sm" :disabled="!hydrated || isPending" />
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
        <Button type="submit" :disabled="!hydrated || isPending">{{ t('app.save') }}</Button>
      </div>
    </form>
  </SharedPageContainer>
</template>
