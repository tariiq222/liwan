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
const untilDateField = computed({ get: () => untilDate.value || null, set: value => { untilDate.value = value || '' } })
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
    <form class="space-y-8" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <p v-if="context" class="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">{{ t('meetingsUx.context.project', { name: context }) }}</p>
      <SharedFormSection :title="t('meetingsUi.sectionSchedule')" class="space-y-4">
        <UFormField :label="t('meetingsUx.seriesName')" name="name" required :error="formErrors.name ? t(`meetingsUx.errors.${formErrors.name}`) : undefined">
          <UInput id="series-name" v-model="name" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.name" required />
        </UFormField>
        <UFormField :label="t('meetingsUi.recurrenceLabel')" name="recurrence">
          <USelect
            id="series-recurrence"
            v-model="recurrence"
            class="w-full"
            :disabled="!hydrated || isPending"
            :items="['none', 'weekly', 'biweekly', 'monthly'].map(code => ({ label: t(`meetingsUi.recurrence.${code}`), value: code }))"
          />
        </UFormField>
        <template v-if="recurrence !== 'none'">
          <UFormField :label="t('meetingsUi.start')" name="start" required :error="formErrors.start ? t(`meetingsUx.errors.${formErrors.start}`) : undefined">
            <UInput id="series-start" v-model="start" type="datetime-local" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.start" required />
          </UFormField>
          <UFormField :label="t('meetingsUi.end')" name="end" required :error="formErrors.end ? t(`meetingsUx.errors.${formErrors.end}`) : undefined">
            <UInput id="series-end" v-model="end" type="datetime-local" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.end" required />
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
            :error="(formErrors.untilCount ? t(`meetingsUx.errors.${formErrors.untilCount}`) : '') || (formErrors.untilDate ? t(`meetingsUx.errors.${formErrors.untilDate}`) : undefined)"
          >
            <UInput v-if="untilMode === 'count'" id="series-count" v-model="untilCount" type="number" min="1" max="60" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.untilCount" />
            <SharedDateField v-else id="series-until-date" v-model="untilDateField" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.untilDate" />
          </UFormField>
          <div v-if="preview.length" class="rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <p class="font-medium">{{ t('meetingsUx.previewTitle') }}</p>
            <ul class="mt-2 grid max-h-48 gap-1 overflow-y-auto" tabindex="0">
              <li v-for="(item, index) in preview" :key="item.start">{{ t('meetingsUx.previewItem', { index: index + 1, start: item.start.replace('T', ' '), end: item.end.replace('T', ' ') }) }}</li>
            </ul>
          </div>
        </template>
        <UFormField :label="t('meetingsUi.location')" name="location">
          <UInput id="series-location" v-model="location" class="w-full" :disabled="!hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('meetingsUi.url')" name="meetingUrl" :error="formErrors.meetingUrl ? t(`meetingsUx.errors.${formErrors.meetingUrl}`) : undefined">
          <UInput id="series-url" v-model="meetingUrl" dir="ltr" class="w-full" :disabled="!hydrated || isPending" :aria-invalid="!!formErrors.meetingUrl" />
        </UFormField>
      </SharedFormSection>
      <SharedFormSection :title="t('meetingsUi.sectionPeople')">
        <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :disabled="!hydrated || isPending" />
      </SharedFormSection>
      <p class="text-sm text-muted-foreground">{{ t('meetingsUx.recurrenceScope') }}</p>
      <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUx.errors.save')" />
      <div class="nasq-form-footer justify-end">
        <UButton type="button" color="neutral" variant="outline" :to="returnTo" :label="t('app.cancel')" />
        <UButton type="submit" :disabled="!hydrated || isPending || Object.keys(formErrors).length > 0" :label="t('app.create')" />
      </div>
    </form>
  </SharedPageContainer>
</template>
