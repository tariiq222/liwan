<script setup lang="ts">
import { owningListBack, recordParentTo, SERIES_LIST_PATHS } from '@/utils/recordListOrigin'
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useMeetingSeries } from '@/composables/useMeetings'
import { usePatchMeetingSeriesSettings } from '@/composables/useMeetingSeriesSettings'
import { formatCalendarDate } from '@nasq/ui/app/composables/calendarDate'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'
import { parsePositiveId } from '@/utils/routeParams'
import { ApiError } from '@/composables/useApi'

const route = useRoute()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const id = computed(() => parsePositiveId(route.params.id))
const query = useMeetingSeries(id)
// An id that is not a canonical positive integer has no record to load and shows the same not-found state as an unknown id.
const pageError = computed(() => query.error.value ?? (id.value !== null ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const { mutateAsync, isPending, error } = usePatchMeetingSeriesSettings()
// Child pages always return to their current record; only normalized list context follows.
const backTo = computed(() => id.value === null ? owningListBack(route.query, SERIES_LIST_PATHS, route.hash) : recordParentTo(`/meetings/series/${id.value}`, route.query, SERIES_LIST_PATHS, route.hash))
const name = ref('')
const location = ref('')
const meetingUrl = ref('')
const attendeeIds = ref<number[]>([])
const secretaryId = ref<number | null>(null)
const loaded = ref(false)
const baseline = ref('')

function snapshot() {
  return JSON.stringify([name.value, location.value, meetingUrl.value, [...attendeeIds.value].sort((a, b) => a - b), secretaryId.value])
}

function seedSeries(series: typeof query.data.value) {
  if (!series || loaded.value) return
  name.value = series.name
  location.value = series.location
  meetingUrl.value = series.meeting_url
  attendeeIds.value = series.attendees.map(person => person.id)
  secretaryId.value = series.secretary?.id ?? null
  baseline.value = snapshot()
  loaded.value = true
}
watch(query.data, seedSeries, { immediate: true })
useSsrQuerySeed(query, seedSeries)

const dirty = computed(() => loaded.value && snapshot() !== baseline.value)
const canEdit = computed(() => query.data.value?.can_edit === true)
function validMeetingUrl(value: string) {
  if (!value.trim()) return true
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname && !/\s/.test(value)
  } catch {
    return false
  }
}
const formErrors = computed(() => ({
  name: name.value.trim() ? '' : 'required',
  meetingUrl: validMeetingUrl(meetingUrl.value) ? '' : 'unsafe_url',
}))
const known = computed(() => {
  const series = query.data.value
  if (!series) return []
  return [series.organizer, series.secretary, ...series.attendees].filter(Boolean) as { id: number; name: string }[]
})
const termination = computed(() => {
  const series = query.data.value
  if (!series) return '—'
  if (series.until_count) return t('meetingsUx.terminationCount', { count: series.until_count }, series.until_count)
  if (series.until_date) return formatCalendarDate(series.until_date, locale.value)
  return t('meetingsUx.terminationOpen')
})

async function save() {
  if (id.value === null || !hydrated.value || isPending.value || !canEdit.value || !dirty.value || Object.values(formErrors.value).some(Boolean)) return
  await mutateAsync({
    id: id.value,
    body: {
      name: name.value.trim(),
      location: location.value,
      meeting_url: meetingUrl.value,
      secretary_id: secretaryId.value,
      attendee_ids: attendeeIds.value,
    },
  })
  baseline.value = snapshot()
  await nextTick()
  await navigateTo(backTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUx.seriesSettingsTitle')" :back-to="backTo" />
    <SharedPageState :loading="query.isLoading.value" :error="pageError" :empty="!query.isLoading.value && !pageError && !query.data.value" @retry="query.refetch">
      <form v-if="query.data.value" class="space-y-8" @submit.prevent="save">
        <SharedUnsavedChanges :dirty="dirty" />
        <UAlert v-if="!canEdit" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUx.seriesSettingsForbidden')" />
        <SharedFormSection :title="t('meetingsUx.seriesDefaultsTitle')" class="space-y-4">
          <UFormField :label="t('meetingsUx.seriesName')" name="name" required :error="formErrors.name ? t(`meetingsUx.errors.${formErrors.name}`) : undefined">
            <UInput id="series-settings-name" v-model="name" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.name" required />
          </UFormField>
          <UFormField :label="t('meetingsUi.location')" name="location">
            <UInput id="series-settings-location" v-model="location" class="w-full" :disabled="!hydrated || isPending || !canEdit" />
          </UFormField>
          <UFormField :label="t('meetingsUi.url')" name="meetingUrl" :error="formErrors.meetingUrl ? t(`meetingsUx.errors.${formErrors.meetingUrl}`) : undefined">
            <UInput id="series-settings-url" v-model="meetingUrl" dir="ltr" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.meetingUrl" />
          </UFormField>
        </SharedFormSection>
        <SharedFormSection :title="t('meetingsUi.sectionPeople')">
          <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :known="known" :disabled="!hydrated || isPending || !canEdit" />
        </SharedFormSection>
        <SharedFormSection :title="t('meetingsUx.scheduleSummaryTitle')" aria-readonly="true" class="space-y-4">
          <dl class="grid gap-2 text-sm">
            <div><dt class="font-medium">{{ t('meetingsUi.recurrenceLabel') }}</dt><dd>{{ t(`meetingsUi.recurrence.${query.data.value.recurrence}`) }}</dd></div>
            <div><dt class="font-medium">{{ t('meetingsUi.untilMode') }}</dt><dd>{{ termination }}</dd></div>
          </dl>
          <p class="text-sm text-muted">{{ t('meetingsUx.seriesSettingsScope') }}</p>
        </SharedFormSection>
        <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUx.seriesSettingsSaveError')" />
        <div class="nasq-form-footer justify-end">
          <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
          <UButton type="submit" :disabled="!hydrated || isPending || !canEdit || !dirty || Object.values(formErrors).some(Boolean)" :label="t('app.save')" />
        </div>
      </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
