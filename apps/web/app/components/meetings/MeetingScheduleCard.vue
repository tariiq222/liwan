<script setup lang="ts">
import type { MeetingSchedulePolicy, MeetingSettings } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { useSaveMeetingSettings } from '@/composables/useMeetingSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// Who may schedule a meeting or a series in this company. A save carries the revision the card was made from; when
// another session saved first the server answers 409, the card reads the saved settings again and tells the manager.
const props = defineProps<{ settings: MeetingSettings; reloadSettings: () => Promise<MeetingSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const save = useSaveMeetingSettings()

const baseline = ref(props.settings)
const policy = ref<MeetingSchedulePolicy>(props.settings.values.schedule_policy)
const reloading = ref(false)
const notice = ref<'conflict' | 'reloadFailed' | null>(null)
const failure = ref<string | null>(null)

const dirty = computed(() => policy.value !== baseline.value.values.schedule_policy)
const busy = computed(() => !hydrated.value || save.isPending.value || reloading.value)
const items = computed(() => baseline.value.options.schedule_policy.map(value => ({
  value,
  label: t(`meetingsSettings.schedule.${value}`),
  description: t(`meetingsSettings.schedule.${value}Hint`),
})))

function adopt(settings: MeetingSettings) {
  baseline.value = settings
  policy.value = settings.values.schedule_policy
}
// A refresh of the settings reaches a card with no edits; a draft in progress is kept and saves against its revision.
watch(() => props.settings, (settings) => {
  if (!dirty.value && !busy.value) adopt(settings)
})

async function readSavedSettings() {
  reloading.value = true
  try {
    adopt(await props.reloadSettings())
    notice.value = 'conflict'
  } catch {
    notice.value = 'reloadFailed'
  } finally {
    reloading.value = false
  }
}

async function submit() {
  if (busy.value || !dirty.value) return
  failure.value = null
  notice.value = null
  try {
    adopt(await save.mutateAsync({ revision: baseline.value.revision, values: { schedule_policy: policy.value } }))
    toast.add({ title: t('meetingsSettings.saved'), color: 'success' })
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return readSavedSettings()
    failure.value = saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
  }
}
</script>

<template>
  <UForm novalidate :state="{ policy }" class="webvue-form" method="post" data-testid="meetings-schedule" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('meetingsSettings.schedule.title')" :description="t('meetingsSettings.schedule.hint')">
      <UAlert v-if="notice === 'conflict'" role="status" color="warning" variant="subtle" icon="i-lucide-refresh-cw" :title="t('meetingsSettings.conflict')" data-testid="meetings-schedule-conflict" />
      <UAlert v-else-if="notice === 'reloadFailed'" role="alert" color="error" variant="subtle" :title="t('meetingsSettings.reloadFailed')" data-testid="meetings-schedule-reload-error" />
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('meetingsSettings.saveFailed')" :description="failure" data-testid="meetings-schedule-error" />
      <UFormField :label="t('meetingsSettings.schedule.label')" name="schedule_policy">
        <URadioGroup v-model="policy" :items="items" :disabled="busy" data-testid="meetings-schedule-policy" />
      </UFormField>
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="submit" class="ms-auto" :loading="save.isPending.value" :disabled="busy || !dirty" :label="t('app.saveChanges')" data-testid="meetings-schedule-save" />
    </SharedFormActions>
  </UForm>
</template>
