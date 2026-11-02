<script setup lang="ts">
import type { HrInsuranceSettings } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'

// The three insurance policies of the company, saved together with the revision the manager read.
// A 409 locks the form until the latest values are reloaded, so a stale draft is never saved by accident.
const props = defineProps<{ settings: HrInsuranceSettings; canEdit: boolean; reloadSettings: () => Promise<HrInsuranceSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending } = usePatchHrInsuranceSettings()
const baseline = ref(props.settings)
const visibility = ref(props.settings.insurance_visibility)
const alertDays = ref<number | undefined>(props.settings.insurance_expiry_alert_days)
const requireId = ref(props.settings.insurance_require_dependent_id)
const failure = ref<unknown>(null)
const reloadFailure = ref<unknown>(null)
const reloading = ref(false)

const validDays = computed(() => Number.isInteger(alertDays.value) && alertDays.value! >= 1 && alertDays.value! <= 365)
const dirty = computed(() => visibility.value !== baseline.value.insurance_visibility
  || alertDays.value !== baseline.value.insurance_expiry_alert_days
  || requireId.value !== baseline.value.insurance_require_dependent_id)
const conflict = computed(() => failure.value instanceof ApiError && failure.value.status === 409)
const locked = computed(() => !props.canEdit || isPending.value || reloading.value || conflict.value)
const message = computed(() => reloadFailure.value
  ? saveErrorMessage(reloadFailure.value, t('errors.generic'), t('errors.saveUncertain'))
  : failure.value ? (conflict.value ? t('hrInsurance.settings.conflict') : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))) : '')

const visibilityItems = computed(() => (['own_enrollment_and_dependents', 'own_enrollment_only'] as const).map(value => ({ value, label: t(`hrInsurance.settings.visibilityOption.${value}`) })))

function fill(settings: HrInsuranceSettings) {
  baseline.value = settings
  visibility.value = settings.insurance_visibility
  alertDays.value = settings.insurance_expiry_alert_days
  requireId.value = settings.insurance_require_dependent_id
}
// Keep the original revision with the draft: a background refresh cannot silently make a stale draft current.
watch(() => props.settings, (settings) => { if (!dirty.value) fill(settings) })

async function reload() {
  if (reloading.value) return
  reloading.value = true
  reloadFailure.value = null
  try {
    fill(await props.reloadSettings())
    failure.value = null
  } catch (error) { reloadFailure.value = error } finally { reloading.value = false }
}
async function submit() {
  if (!hydrated.value || locked.value || !dirty.value || !validDays.value) return
  failure.value = null
  try {
    fill(await save({
      insurance_visibility: visibility.value,
      insurance_expiry_alert_days: alertDays.value!,
      insurance_require_dependent_id: requireId.value,
      revision: baseline.value.revision,
    }))
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm novalidate :state="{ visibility, alertDays, requireId }" class="liwan-form" method="post" data-testid="hr-insurance-settings" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('hrInsurance.settings.title')" :description="t('hrInsurance.settings.hint')">
      <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('hrInsurance.settings.saveError')" :description="message" />
      <UButton v-if="conflict" color="neutral" variant="outline" :label="t('hrInsurance.settings.reload')" :loading="reloading" :disabled="reloading" @click="reload" />
      <UFormField :label="t('hrInsurance.settings.visibility')" name="insurance-visibility" :help="t('hrInsurance.settings.visibilityHint')">
        <USelect id="insurance-visibility" v-model="visibility" class="w-full" :items="visibilityItems" :disabled="!hydrated || locked" data-testid="hr-insurance-visibility" />
      </UFormField>
      <UFormField :label="t('hrInsurance.settings.alertDays')" name="insurance-alert-days" :help="t('hrInsurance.settings.alertDaysHint')">
        <UInputNumber id="insurance-alert-days" v-model="alertDays" class="w-full" :min="1" :max="365" :step="1" :disabled="!hydrated || locked" data-testid="hr-insurance-alert-days" />
      </UFormField>
      <UFormField name="insurance-require-id">
        <USwitch v-model="requireId" :label="t('hrInsurance.settings.requireId')" :description="t('hrInsurance.settings.requireIdHint')" :disabled="!hydrated || locked" data-testid="hr-insurance-require-id" />
      </UFormField>
    </SharedFormSection>
    <SharedFormActions v-if="props.canEdit">
      <UButton type="submit" class="ms-auto" :loading="isPending" :disabled="!hydrated || locked || !dirty || !validDays" :label="t('app.saveChanges')" data-testid="hr-insurance-settings-save" />
    </SharedFormActions>
  </UForm>
</template>
