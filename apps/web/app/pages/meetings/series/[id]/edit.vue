<script setup lang="ts">
import { owningListBack, recordParentTo } from '@/utils/recordListOrigin'
import { SERIES_LIST_PATHS } from '@/modules/meetings/navigation'
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useMeetingSeries } from '@/composables/useMeetings'
import { usePatchMeetingSeriesSettings } from '@/composables/useMeetingSeriesSettings'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'
import { parsePositiveId } from '@/utils/routeParams'
import { ApiError } from '@/composables/useApi'

const route = useRoute()
const sourcePaths = useRecordListPaths(SERIES_LIST_PATHS)
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => parsePositiveId(route.params.id))
const query = useMeetingSeries(id)
// An id that is not a canonical positive integer has no record to load and shows the same not-found state as an unknown id.
const pageError = computed(() => query.error.value ?? (id.value !== null ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const { mutateAsync, isPending, error } = usePatchMeetingSeriesSettings()
// Child pages always return to their current record; only normalized list context follows.
const backTo = computed(() => id.value === null ? owningListBack(route.query, sourcePaths.value, route.hash) : recordParentTo(`/meetings/series/${id.value}`, route.query, sourcePaths.value, route.hash))
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
  if (series.until_date) return formatCalendarDate(series.until_date)
  return t('meetingsUx.terminationOpen')
})

const formElement = ref<HTMLFormElement | null>(null)
const { attemptedSubmit, visibleErrors, validate } = useMeetingFormFeedback(formErrors, formElement)

async function save() {
  if (id.value === null || !hydrated.value || isPending.value || !canEdit.value || !dirty.value || !validate()) return
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
      <form ref="formElement" novalidate v-if="query.data.value" class="grid gap-(--liwan-gap-card)" @submit.prevent="save">
        <SharedUnsavedChanges :dirty="dirty" />
      <UAlert v-if="attemptedSubmit && Object.values(formErrors).filter(Boolean).length > 1" color="error" variant="subtle" role="alert" :title="t('meetingsUx.validationSummary', { count: Object.values(formErrors).filter(Boolean).length })" />
        <UAlert v-if="!canEdit" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUx.seriesSettingsForbidden')" />
        <SharedFormSection panel :title="t('meetingsUx.seriesDefaultsTitle')">
          <div class="grid gap-(--liwan-gap-card)">
          <UFormField :label="t('meetingsUx.seriesName')" name="name" required :error="visibleErrors.name ? t(`meetingsUx.errors.${visibleErrors.name}`) : undefined">
            <UInput id="series-settings-name" v-model="name" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!visibleErrors.name" required />
          </UFormField>
          <UFormField :label="t('meetingsUi.location')" name="location">
            <UInput id="series-settings-location" v-model="location" class="w-full" :disabled="!hydrated || isPending || !canEdit" />
          </UFormField>
          <UFormField :label="t('meetingsUi.url')" name="meetingUrl" :error="visibleErrors.meetingUrl ? t(`meetingsUx.errors.${visibleErrors.meetingUrl}`) : undefined">
            <UInput id="series-settings-url" v-model="meetingUrl" dir="ltr" class="w-full" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!visibleErrors.meetingUrl" />
          </UFormField>
          </div>
        </SharedFormSection>
        <SharedFormSection panel :title="t('meetingsUi.sectionPeople')">
          <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :known="known" :disabled="!hydrated || isPending || !canEdit" />
        </SharedFormSection>
        <SharedFormSection panel :title="t('meetingsUx.scheduleSummaryTitle')" :description="t('meetingsUx.seriesSettingsScope')" aria-readonly="true">
          <dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt class="text-xs text-muted">{{ t('meetingsUi.recurrenceLabel') }}</dt><dd class="text-highlighted">{{ t(`meetingsUi.recurrence.${query.data.value.recurrence}`) }}</dd></div>
            <div><dt class="text-xs text-muted">{{ t('meetingsUi.untilMode') }}</dt><dd class="text-highlighted">{{ termination }}</dd></div>
          </dl>
        </SharedFormSection>
        <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUx.seriesSettingsSaveError')" />
<SharedFormActions>
          <p v-if="!loaded || dirty" class="text-xs text-muted">{{ t('meetingsUx.requiredHint') }}</p>
        <p v-if="loaded && !dirty" class="text-xs text-muted">{{ t('meetingsUx.unchangedDraft') }}</p>
          <div class="ms-auto flex flex-wrap items-center gap-2">
            <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
            <UButton type="submit" :disabled="!hydrated || isPending || !canEdit || !dirty" :loading="isPending" :label="t('meetingsUx.saveChanges')" />
          </div>
        </SharedFormActions>
      </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
