<script setup lang="ts">
import type { HrShiftSettings } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'

const props = defineProps<{ settings: HrShiftSettings; canEdit: boolean; reloadSettings: () => Promise<HrShiftSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending } = usePatchHrShiftSettings()
// Keep the original revision with the draft: background refreshes cannot silently make a stale draft current.
const baseline = ref(props.settings)
const reference = ref(props.settings.day_reference)
const failure = ref<unknown>(null)
const reloadFailure = ref<unknown>(null)
const reloading = ref(false)
const dirty = computed(() => reference.value !== baseline.value.day_reference)
watch(() => props.settings, (settings) => {
  if (!dirty.value) {
    baseline.value = settings
    reference.value = settings.day_reference
  }
})
const items = computed(() => [
  { value: 'company', label: t('hr.shiftSettings.company') },
  { value: 'user', label: t('hr.shiftSettings.user') },
])
const conflict = computed(() => failure.value instanceof ApiError && failure.value.status === 409)
const message = computed(() => reloadFailure.value ? saveErrorMessage(reloadFailure.value, t('errors.generic'), t('errors.saveUncertain')) : failure.value ? (conflict.value ? t('hr.shiftSettings.conflict') : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))) : '')
async function reload() {
  if (reloading.value) return
  reloading.value = true
  reloadFailure.value = null
  try {
    const settings = await props.reloadSettings()
    reference.value = settings.day_reference
    baseline.value = settings
    failure.value = null
  } catch (error) { reloadFailure.value = error } finally { reloading.value = false }
}
async function submit() {
  if (!hydrated.value || isPending.value || !props.canEdit || !dirty.value || conflict.value || reloading.value) return
  failure.value = null
  try {
    const saved = await save({ day_reference: reference.value, revision: baseline.value.revision })
    baseline.value = saved
    reference.value = saved.day_reference
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm novalidate :state="{ reference }" class="webvue-form" method="post" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('hr.shiftSettings.title')" :description="t('hr.shiftSettings.hint')">
      <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('hr.shiftSettings.saveError')" :description="message" />
      <UButton v-if="conflict" color="neutral" variant="outline" :label="t('hr.shiftSettings.reload')" :loading="reloading" :disabled="reloading" @click="reload" />
      <UFormField :label="t('hr.shiftSettings.reference')" name="shift-day-reference" :help="t('hr.shiftSettings.defaultHint', { timezone: props.settings.company_timezone })">
        <USelect id="shift-day-reference" v-model="reference" class="w-full" :items="items" :disabled="!hydrated || !props.canEdit || isPending || reloading || conflict" />
      </UFormField>
    </SharedFormSection>
    <SharedFormActions v-if="props.canEdit">
      <UButton type="submit" class="ms-auto" :loading="isPending" :disabled="!hydrated || isPending || !dirty || conflict || reloading" :label="t('app.saveChanges')" />
    </SharedFormActions>
  </UForm>
</template>
