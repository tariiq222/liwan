<script setup lang="ts">
import type { HrShiftSettings } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'

const props = defineProps<{ settings: HrShiftSettings; canEdit: boolean; reloadSettings: () => Promise<HrShiftSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending } = usePatchHrShiftSettings()
// Keep the original revision with the draft: background refreshes cannot silently make a stale draft current.
const baseline = ref(props.settings)
const reference = ref(props.settings.day_reference)
const defaultSchedule = ref(props.settings.default_schedule?.id)
const schedules = useHrShiftSchedules({ active: 'true', limit: 100, offset: 0 })
const failure = ref<unknown>(null)
const reloadFailure = ref<unknown>(null)
const reloading = ref(false)
const scheduleChanged = computed(() => defaultSchedule.value !== baseline.value.default_schedule?.id)
const dirty = computed(() => reference.value !== baseline.value.day_reference || scheduleChanged.value)
watch(() => props.settings, (settings) => {
  if (!dirty.value) {
    baseline.value = settings
    reference.value = settings.day_reference
    defaultSchedule.value = settings.default_schedule?.id
  }
})
const items = computed(() => [
  { value: 'company', label: t('hr.shiftSettings.company') },
  { value: 'user', label: t('hr.shiftSettings.user') },
])
// The current default always stays selectable, even when the page of active schedules does not list it.
const scheduleItems = computed(() => {
  const listed = (schedules.data.value?.items ?? []).map(({ id, name }) => ({ value: id, label: name }))
  const current = baseline.value.default_schedule
  return current && !listed.some(item => item.value === current.id) ? [{ value: current.id, label: current.name }, ...listed] : listed
})
const conflict = computed(() => failure.value instanceof ApiError && failure.value.status === 409)
const message = computed(() => reloadFailure.value ? saveErrorMessage(reloadFailure.value, t('errors.generic'), t('errors.saveUncertain')) : failure.value ? (conflict.value ? t('hr.shiftSettings.conflict') : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))) : '')
async function reload() {
  if (reloading.value) return
  reloading.value = true
  reloadFailure.value = null
  try {
    const settings = await props.reloadSettings()
    reference.value = settings.day_reference
    defaultSchedule.value = settings.default_schedule?.id
    baseline.value = settings
    failure.value = null
  } catch (error) { reloadFailure.value = error } finally { reloading.value = false }
}
async function submit() {
  if (!hydrated.value || isPending.value || !props.canEdit || !dirty.value || conflict.value || reloading.value) return
  failure.value = null
  try {
    const saved = await save({
      day_reference: reference.value,
      ...(scheduleChanged.value && defaultSchedule.value ? { default_schedule_id: defaultSchedule.value } : {}),
      revision: baseline.value.revision,
    })
    baseline.value = saved
    reference.value = saved.day_reference
    defaultSchedule.value = saved.default_schedule?.id
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm novalidate :state="{ reference, defaultSchedule }" class="liwan-form" method="post" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('hr.shiftSettings.title')" :description="t('hr.shiftSettings.hint')">
      <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('hr.shiftSettings.saveError')" :description="message" />
      <UButton v-if="conflict" color="neutral" variant="outline" :label="t('hr.shiftSettings.reload')" :loading="reloading" :disabled="reloading" @click="reload" />
      <UFormField :label="t('hr.shiftSettings.reference')" name="shift-day-reference" :help="t('hr.shiftSettings.defaultHint', { timezone: props.settings.company_timezone })">
        <USelect id="shift-day-reference" v-model="reference" class="w-full" :items="items" :disabled="!hydrated || !props.canEdit || isPending || reloading || conflict" />
      </UFormField>
      <UFormField :label="t('hr.shiftSettings.defaultSchedule')" name="shift-default-schedule" :help="t('hr.shiftSettings.defaultScheduleHint')">
        <USelect id="shift-default-schedule" v-model="defaultSchedule" class="w-full" :items="scheduleItems" :disabled="!hydrated || !props.canEdit || isPending || reloading || conflict || !scheduleItems.length" />
      </UFormField>
    </SharedFormSection>
    <SharedFormActions v-if="props.canEdit">
      <UButton type="submit" class="ms-auto" :loading="isPending" :disabled="!hydrated || isPending || !dirty || conflict || reloading" :label="t('app.saveChanges')" />
    </SharedFormActions>
  </UForm>
</template>
