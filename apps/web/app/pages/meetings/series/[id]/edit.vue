<script setup lang="ts">
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useMeetingSeries } from '@/composables/useMeetings'
import { usePatchMeetingSeriesSettings } from '@/composables/useMeetingSeriesSettings'
import { formatCalendarDate } from '@/composables/calendarDate'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'

const route = useRoute()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const query = useMeetingSeries(id)
const { mutateAsync, isPending, error } = usePatchMeetingSeriesSettings()
// The owning list is fixed by this page's own route, so the return trip is
// literal and carries only the state the list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/meetings/series', query: listQuery }
})
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
  if (series.until_count) return t('meetingsUx.terminationCount', { count: series.until_count })
  if (series.until_date) return formatCalendarDate(series.until_date, locale.value)
  return t('meetingsUx.terminationOpen')
})

async function save() {
  if (!hydrated.value || isPending.value || !canEdit.value || !dirty.value || Object.values(formErrors.value).some(Boolean)) return
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
  await navigateTo(`/meetings/series/${id.value}`)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUx.seriesSettingsTitle')" :back-to="backTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !query.data.value" @retry="query.refetch">
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
          <p class="text-sm text-muted-foreground">{{ t('meetingsUx.seriesSettingsScope') }}</p>
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
