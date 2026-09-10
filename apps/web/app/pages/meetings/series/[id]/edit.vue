<script setup lang="ts">
import MeetingPeopleFields from '@/components/meetings/MeetingPeopleFields.vue'
import { useMeetingSeries } from '@/composables/useMeetings'
import { usePatchMeetingSeriesSettings } from '@/composables/useMeetingSeriesSettings'
import { formatCalendarDate } from '@/composables/calendarDate'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const query = useMeetingSeries(id)
const { mutateAsync, isPending, error } = usePatchMeetingSeriesSettings()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/meetings/series/${id.value}`, ['/meetings/series']))
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

watch(query.data, series => {
  if (!series || loaded.value) return
  name.value = series.name
  location.value = series.location
  meetingUrl.value = series.meeting_url
  attendeeIds.value = series.attendees.map(person => person.id)
  secretaryId.value = series.secretary?.id ?? null
  baseline.value = snapshot()
  loaded.value = true
}, { immediate: true })

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
  await navigateTo(returnTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUx.seriesSettingsTitle')" :back-to="returnTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !query.data.value" @retry="query.refetch">
      <form v-if="query.data.value" class="nasq-form nasq-panel nasq-panel-body grid gap-5" @submit.prevent="save">
        <SharedUnsavedChanges :dirty="dirty" />
        <p v-if="!canEdit" role="alert" class="text-sm text-destructive">{{ t('meetingsUx.seriesSettingsForbidden') }}</p>
        <SharedFormSection :title="t('meetingsUx.seriesDefaultsTitle')" class="grid gap-4">
          <div class="grid gap-2">
            <Label for="series-settings-name">{{ t('meetingsUx.seriesName') }}</Label>
            <Input id="series-settings-name" v-model="name" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.name" aria-describedby="series-settings-name-error" required />
            <p v-if="formErrors.name" id="series-settings-name-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.name}`) }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="series-settings-location">{{ t('meetingsUi.location') }}</Label>
            <Input id="series-settings-location" v-model="location" :disabled="!hydrated || isPending || !canEdit" />
          </div>
          <div class="grid gap-2">
            <Label for="series-settings-url">{{ t('meetingsUi.url') }}</Label>
            <Input id="series-settings-url" v-model="meetingUrl" dir="ltr" :disabled="!hydrated || isPending || !canEdit" :aria-invalid="!!formErrors.meetingUrl" aria-describedby="series-settings-url-error" />
            <p v-if="formErrors.meetingUrl" id="series-settings-url-error" role="alert" class="text-sm text-destructive">{{ t(`meetingsUx.errors.${formErrors.meetingUrl}`) }}</p>
          </div>
        </SharedFormSection>
        <SharedFormSection :title="t('meetingsUi.sectionPeople')" class="grid gap-4">
          <MeetingPeopleFields v-model:attendee-ids="attendeeIds" v-model:secretary-id="secretaryId" :known="known" :disabled="!hydrated || isPending || !canEdit" />
        </SharedFormSection>
        <SharedFormSection :title="t('meetingsUx.scheduleSummaryTitle')" aria-readonly="true" class="grid gap-4">
          <dl class="grid gap-2 text-sm">
            <div><dt class="font-medium">{{ t('meetingsUi.recurrenceLabel') }}</dt><dd>{{ t(`meetingsUi.recurrence.${query.data.value.recurrence}`) }}</dd></div>
            <div><dt class="font-medium">{{ t('meetingsUi.untilMode') }}</dt><dd>{{ termination }}</dd></div>
          </dl>
          <p class="text-sm text-muted-foreground">{{ t('meetingsUx.seriesSettingsScope') }}</p>
        </SharedFormSection>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ t('meetingsUx.seriesSettingsSaveError') }}</p>
        <div class="nasq-form-footer justify-end">
          <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
          <Button type="submit" :disabled="!hydrated || isPending || !canEdit || !dirty || Object.values(formErrors).some(Boolean)">{{ t('app.save') }}</Button>
        </div>
      </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
