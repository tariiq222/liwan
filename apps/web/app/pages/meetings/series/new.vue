<script setup lang="ts">
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useCreateMeetingSeries } from '@/composables/useMeetings'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { normalizeRecurrenceEnd } from '@/utils/meetingForm'
import { toUtcDateTime } from '@/utils/meetingDateTime'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const name = ref('')
const recurrence = ref<'none' | 'weekly' | 'biweekly' | 'monthly'>('none')
const untilCount = ref('4')
const untilDate = ref('')
const untilMode = ref<'count' | 'date'>('count')
const start = ref('')
const end = ref('')
const location = ref('')
const meetingUrl = ref('')
const attendeeIds = ref<number[]>([])
const secretaryId = ref<number | null>(null)
const { mutateAsync, isPending, error } = useCreateMeetingSeries()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/meetings/series', ['/meetings']))
watch(untilMode, (mode) => {
  if (mode === 'count') untilDate.value = ''
  else untilCount.value = ''
})
function snapshot() {
  return JSON.stringify([name.value, recurrence.value, untilMode.value, untilCount.value, untilDate.value, start.value, end.value, location.value, meetingUrl.value, attendeeIds.value, secretaryId.value])
}
const baseline = ref(snapshot())
const dirty = computed(() => snapshot() !== baseline.value)

async function save() {
  if (!hydrated.value || !name.value.trim()) return
  const termination = recurrence.value === 'none'
    ? { until_count: undefined, until_date: undefined }
    : normalizeRecurrenceEnd({ mode: untilMode.value, count: untilCount.value, date: untilDate.value })
  const series = await mutateAsync({
    name: name.value.trim(),
    recurrence: recurrence.value,
    ...termination,
    start_datetime: recurrence.value !== 'none' ? toUtcDateTime(start.value) : undefined,
    end_datetime: recurrence.value !== 'none' ? toUtcDateTime(end.value) : undefined,
    location: location.value || undefined,
    meeting_url: meetingUrl.value || undefined,
    attendee_ids: attendeeIds.value,
    secretary_id: secretaryId.value || undefined,
  })
  baseline.value = snapshot()
  await nextTick()
  await navigateTo(`/meetings/series/${series.id}`)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUi.newSeries')" :back-to="returnTo" />
    <form class="nasq-form nasq-panel nasq-panel-body grid gap-4" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <Label for="series-name">{{ t('meetingsUi.title') }}</Label>
      <Input id="series-name" v-model="name" :disabled="!hydrated || isPending" required />
      <Label for="series-recurrence">{{ t('meetingsUi.recurrenceLabel') }}</Label>
      <select id="series-recurrence" v-model="recurrence" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending">
        <option v-for="code in ['none', 'weekly', 'biweekly', 'monthly']" :key="code" :value="code">{{ t(`meetingsUi.recurrence.${code}`) }}</option>
      </select>
      <template v-if="recurrence !== 'none'">
        <Label for="series-start">{{ t('meetingsUi.start') }}</Label>
        <Input id="series-start" v-model="start" type="datetime-local" :disabled="!hydrated || isPending" required />
        <Label for="series-end">{{ t('meetingsUi.end') }}</Label>
        <Input id="series-end" v-model="end" type="datetime-local" :disabled="!hydrated || isPending" required />
        <Label for="series-end-mode">{{ t('meetingsUi.untilMode') }}</Label>
        <select id="series-end-mode" v-model="untilMode" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending">
          <option value="count">{{ t('meetingsUi.untilCount') }}</option>
          <option value="date">{{ t('meetingsUi.untilDate') }}</option>
        </select>
        <Input v-if="untilMode === 'count'" id="series-count" v-model="untilCount" type="number" min="1" max="60" :disabled="!hydrated || isPending" />
        <Input v-else id="series-until-date" v-model="untilDate" type="date" :disabled="!hydrated || isPending" />
      </template>
      <Label for="series-location">{{ t('meetingsUi.location') }}</Label>
      <Input id="series-location" v-model="location" :disabled="!hydrated || isPending" />
      <Label for="series-url">{{ t('meetingsUi.url') }}</Label>
      <Input id="series-url" v-model="meetingUrl" dir="ltr" :disabled="!hydrated || isPending" />
      <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :disabled="!hydrated || isPending" />
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error.message }}</p>
      <div class="flex justify-end gap-2">
        <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
        <Button type="submit" :disabled="!hydrated || isPending || !name.trim()">{{ t('app.create') }}</Button>
      </div>
    </form>
  </SharedPageContainer>
</template>
