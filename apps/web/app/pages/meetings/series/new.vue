<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useCreateMeetingSeries } from '@/composables/useMeetings'
import { buildRecurrencePreview, getMeetingFormErrors, normalizeRecurrenceEnd } from '@/utils/meetingForm'
import { toUtcDateTime } from '@/utils/meetingDateTime'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const name = ref('')
const recurrence = ref<'none' | 'weekly' | 'biweekly' | 'monthly'>('none')
const untilCount = ref('4')
const untilDate = ref('')
const untilDateField = computed({ get: () => untilDate.value || null, set: value => { untilDate.value = value || '' } })
const untilMode = ref<'count' | 'date'>('count')
const start = ref('')
const end = ref('')
const location = ref('')
const meetingUrl = ref('')
const attendeeIds = ref<number[]>([])
const secretaryId = ref<number | null>(null)
const { mutateAsync, isPending, error, reset } = useCreateMeetingSeries()
const sourcePaths = useRecordListPaths(['/meetings/series'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
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
const { fieldErrors: serverErrors, submitError } = useMeetingSubmitError({
  error,
  reset,
  edits: snapshot,
  fields: {
    name: 'name',
    recurrence: 'recurrence',
    start_datetime: 'start',
    end_datetime: 'end',
    until_count: 'untilCount',
    until_date: 'untilDate',
    location: 'location',
    meeting_url: 'meetingUrl',
    secretary_id: 'secretary',
    attendee_ids: 'attendees',
  },
})
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

const formElement = ref<HTMLFormElement | null>(null)
const { attemptedSubmit, visibleErrors, validate } = useMeetingFormFeedback(formErrors, formElement)

async function save() {
  if (!hydrated.value || isPending.value || !validate()) return
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
  await navigateTo({ path: `/meetings/series/${series.id}`, query: { returnTo: router.resolve(backTo.value).fullPath } }, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t('meetingsUi.newSeries')" :back-to="backTo">
    <form ref="formElement" novalidate class="space-y-8" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <UAlert v-if="attemptedSubmit && Object.values(formErrors).filter(Boolean).length > 1" color="error" variant="subtle" role="alert" :title="t('meetingsUx.validationSummary', { count: Object.values(formErrors).filter(Boolean).length })" />
      <p v-if="context" class="rounded-control bg-elevated/50 px-3 py-2 text-sm ring ring-default">{{ t('meetingsUx.context.project', { name: context }) }}</p>
      <SharedFormSection :title="t('meetingsUi.sectionSchedule')" class="space-y-4">
        <UFormField :label="t('meetingsUx.seriesName')" name="name" required :error="serverErrors.name || (visibleErrors.name ? t(`meetingsUx.errors.${visibleErrors.name}`) : undefined)">
          <UInput id="series-name" v-model="name" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.name" required />
        </UFormField>
        <UFormField :label="t('meetingsUi.recurrenceLabel')" name="recurrence" :error="serverErrors.recurrence">
          <USelect
            id="series-recurrence"
            v-model="recurrence"
            class="w-full"
            :disabled="!hydrated || isPending"
            :items="['none', 'weekly', 'biweekly', 'monthly'].map(code => ({ label: t(`meetingsUi.recurrence.${code}`), value: code }))"
          />
        </UFormField>
        <template v-if="recurrence !== 'none'">
          <UFormField :label="t('meetingsUi.start')" name="start" required :error="serverErrors.start || (visibleErrors.start ? t(`meetingsUx.errors.${visibleErrors.start}`) : undefined)">
            <UInput id="series-start" v-model="start" type="datetime-local" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.start" required />
          </UFormField>
          <UFormField :label="t('meetingsUi.end')" name="end" required :error="serverErrors.end || (visibleErrors.end ? t(`meetingsUx.errors.${visibleErrors.end}`) : undefined)">
            <UInput id="series-end" v-model="end" type="datetime-local" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.end" required />
          </UFormField>
          <UFormField :label="t('meetingsUi.untilMode')" name="untilMode">
            <USelect
              id="series-end-mode"
              v-model="untilMode"
              class="w-full"
              :disabled="!hydrated || isPending"
              :items="[{ label: t('meetingsUi.untilCount'), value: 'count' }, { label: t('meetingsUi.untilDate'), value: 'date' }]"
            />
          </UFormField>
          <UFormField
            :label="untilMode === 'count' ? t('meetingsUi.untilCount') : t('meetingsUi.untilDate')"
            name="until"
            :error="serverErrors.untilCount || serverErrors.untilDate || (visibleErrors.untilCount ? t(`meetingsUx.errors.${visibleErrors.untilCount}`) : '') || (visibleErrors.untilDate ? t(`meetingsUx.errors.${visibleErrors.untilDate}`) : undefined)"
          >
            <UInput v-if="untilMode === 'count'" id="series-count" v-model="untilCount" type="number" min="1" max="60" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.untilCount" />
            <SharedDateField v-else id="series-until-date" v-model="untilDateField" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.untilDate" />
          </UFormField>
          <div v-if="preview.length" class="rounded-control bg-elevated/50 p-3 text-sm ring ring-default">
            <p class="font-medium text-highlighted">{{ t('meetingsUx.previewTitle') }}</p>
            <ul class="mt-2 grid max-h-48 gap-1 overflow-y-auto" tabindex="0">
              <li v-for="(item, index) in preview" :key="item.start">{{ t('meetingsUx.previewItem', { index: index + 1, start: item.start.replace('T', ' '), end: item.end.replace('T', ' ') }) }}</li>
            </ul>
          </div>
        </template>
        <UFormField :label="t('meetingsUi.location')" name="location" :error="serverErrors.location">
          <UInput id="series-location" v-model="location" class="w-full" :disabled="!hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('meetingsUi.url')" name="meetingUrl" :error="serverErrors.meetingUrl || (visibleErrors.meetingUrl ? t(`meetingsUx.errors.${visibleErrors.meetingUrl}`) : undefined)">
          <UInput id="series-url" v-model="meetingUrl" dir="ltr" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!visibleErrors.meetingUrl" />
        </UFormField>
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.sectionPeople')">
        <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :attendees-error="serverErrors.attendees" :secretary-error="serverErrors.secretary" :disabled="!hydrated || isPending" />
      </SharedFormSection>
      <p class="text-sm text-muted">{{ t('meetingsUx.recurrenceScope') }}</p>
      <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="submitError" />
      <SharedFormActions class="justify-end">
        <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" :disabled="!hydrated || isPending" :loading="isPending" :label="t('meetingsUx.createSeries')" />
      </SharedFormActions>
    </form>
  </SharedCreatePanel>
</template>
