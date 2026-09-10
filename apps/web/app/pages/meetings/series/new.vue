<script setup lang="ts">
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useCreateMeetingSeries } from '@/composables/useMeetings'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
import { buildRecurrencePreview, getMeetingFormErrors, normalizeRecurrenceEnd } from '@/utils/meetingForm'
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
const projectId = computed(() => {
  const value = Number(route.query.project_id)
  return Number.isInteger(value) && value > 0 ? value : undefined
})
const context = computed(() => projectId.value ? String(route.query.project_name || projectId.value) : '')
watch(untilMode, (mode) => {
  if (mode === 'count') untilDate.value = ''
  else untilCount.value = ''
})
watch(recurrence, mode => {
  if (mode === 'none') {
    untilCount.value = ''
    untilDate.value = ''
  } else if (!untilCount.value && !untilDate.value) {
    untilMode.value = 'count'
    untilCount.value = '4'
  }
})
function snapshot() {
  return JSON.stringify([name.value, recurrence.value, untilMode.value, untilCount.value, untilDate.value, start.value, end.value, location.value, meetingUrl.value, attendeeIds.value, secretaryId.value])
}
const baseline = ref(snapshot())
const dirty = computed(() => snapshot() !== baseline.value)
const formErrors = computed(() => getMeetingFormErrors({
  name: name.value,
  start: start.value,
  end: end.value,
  meetingUrl: meetingUrl.value,
  recurrence: recurrence.value,
  untilMode: untilMode.value,
  untilCount: untilCount.value,
  untilDate: untilDate.value,
}))
const preview = computed(() => buildRecurrencePreview({
  recurrence: recurrence.value,
  start: start.value,
  end: end.value,
  untilCount: untilMode.value === 'count' ? Number(untilCount.value) : undefined,
  untilDate: untilMode.value === 'date' ? untilDate.value : undefined,
}))

async function save() {
  if (!hydrated.value || Object.keys(formErrors.value).length) return
  const termination = recurrence.value === 'none'
    ? { until_count: undefined, until_date: undefined }
    : normalizeRecurrenceEnd({ mode: untilMode.value, count: untilCount.value, date: untilDate.value })
  const series = await mutateAsync({
    name: name.value.trim(),
    project_id: projectId.value,
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
  await navigateTo({ path: `/meetings/series/${series.id}`, query: returnToQuery(returnTo.value) })
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUi.newSeries')" :back-to="returnTo" />
    <form class="nasq-form nasq-panel nasq-panel-body grid gap-5" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <p v-if="context" class="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">{{ t('meetingsUx.context.project', { name: context }) }}</p>
      <SharedFormSection :title="t('meetingsUi.sectionSchedule')" class="grid gap-4">
        <div class="grid gap-2">
          <Label for="series-name">{{ t('meetingsUx.seriesName') }}</Label>
          <Input id="series-name" v-model="name" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.name" aria-describedby="series-name-error" required />
          <p v-if="formErrors.name" id="series-name-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.name}`) }}</p>
        </div>
        <div class="grid gap-2">
          <Label for="series-recurrence">{{ t('meetingsUi.recurrenceLabel') }}</Label>
          <select id="series-recurrence" v-model="recurrence" class="border-input h-9 w-full min-w-0 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending">
          <option v-for="code in ['none', 'weekly', 'biweekly', 'monthly']" :key="code" :value="code">{{ t(`meetingsUi.recurrence.${code}`) }}</option>
          </select>
        </div>
        <template v-if="recurrence !== 'none'">
          <div class="grid gap-2">
            <Label for="series-start">{{ t('meetingsUi.start') }}</Label>
            <Input id="series-start" v-model="start" type="datetime-local" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.start" aria-describedby="series-start-error" required />
            <p v-if="formErrors.start" id="series-start-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.start}`) }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="series-end">{{ t('meetingsUi.end') }}</Label>
            <Input id="series-end" v-model="end" type="datetime-local" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.end" aria-describedby="series-end-error" required />
            <p v-if="formErrors.end" id="series-end-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.end}`) }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="series-end-mode">{{ t('meetingsUi.untilMode') }}</Label>
            <select id="series-end-mode" v-model="untilMode" class="border-input h-9 w-full min-w-0 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending">
              <option value="count">{{ t('meetingsUi.untilCount') }}</option>
              <option value="date">{{ t('meetingsUi.untilDate') }}</option>
            </select>
          </div>
          <div class="grid gap-2">
            <Label v-if="untilMode === 'count'" for="series-count">{{ t('meetingsUi.untilCount') }}</Label>
            <Label v-else for="series-until-date">{{ t('meetingsUi.untilDate') }}</Label>
            <Input v-if="untilMode === 'count'" id="series-count" v-model="untilCount" type="number" min="1" max="60" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.untilCount" aria-describedby="series-count-error" />
            <Input v-else id="series-until-date" v-model="untilDate" type="date" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.untilDate" aria-describedby="series-until-date-error" />
            <p v-if="formErrors.untilCount" id="series-count-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.untilCount}`) }}</p>
            <p v-if="formErrors.untilDate" id="series-until-date-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.untilDate}`) }}</p>
          </div>
          <div v-if="preview.length" class="rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <p class="font-medium">{{ t('meetingsUx.previewTitle') }}</p>
            <ul class="mt-2 grid max-h-48 gap-1 overflow-y-auto" tabindex="0">
              <li v-for="(item, index) in preview" :key="item.start">{{ t('meetingsUx.previewItem', { index: index + 1, start: item.start.replace('T', ' '), end: item.end.replace('T', ' ') }) }}</li>
            </ul>
          </div>
        </template>
        <div class="grid gap-2">
          <Label for="series-location">{{ t('meetingsUi.location') }}</Label>
          <Input id="series-location" v-model="location" :disabled="!hydrated || isPending" />
        </div>
        <div class="grid gap-2">
          <Label for="series-url">{{ t('meetingsUi.url') }}</Label>
        <Input id="series-url" v-model="meetingUrl" dir="ltr" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.meetingUrl" aria-describedby="series-url-error" />
        <p v-if="formErrors.meetingUrl" id="series-url-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.meetingUrl}`) }}</p>
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.sectionPeople')" class="grid gap-4">
        <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :disabled="!hydrated || isPending" />
      </SharedFormSection>
      <p class="text-sm text-muted-foreground">{{ t('meetingsUx.recurrenceScope') }}</p>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ t('meetingsUx.errors.save') }}</p>
      <div class="nasq-form-footer justify-end">
        <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
        <Button type="submit" :disabled="!hydrated || isPending || Object.keys(formErrors).length > 0">{{ t('app.create') }}</Button>
      </div>
    </form>
  </SharedPageContainer>
</template>
