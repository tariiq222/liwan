<script setup lang="ts">
import type { HrInsuranceSettings } from '@liwan/contracts'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// The three insurance policies of the company: what the employee sees, when the managers are alerted before a plan ends,
// and whether a dependent needs an identification number. It saves with the revision the manager read: a save after
// someone else's answers 409, keeps the draft and locks the card until the current policy is reloaded. An alert window
// outside one to 365 days is told at its field and not sent.
const props = defineProps<{ settings: HrInsuranceSettings; canEdit: boolean; reloadSettings: () => Promise<HrInsuranceSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: saveSettings } = usePatchHrInsuranceSettings()

const ALERT_DAYS = { min: 1, max: 365 }
type Draft = {
  insurance_visibility: HrInsuranceSettings['insurance_visibility']
  insurance_expiry_alert_days: number | undefined
  insurance_require_dependent_id: boolean
}
const { draft, state, save, revert, reload } = useSettingsForm<HrInsuranceSettings, Draft>({
  source: () => props.settings,
  read: ({ insurance_visibility, insurance_expiry_alert_days, insurance_require_dependent_id }) =>
    ({ insurance_visibility, insurance_expiry_alert_days, insurance_require_dependent_id }),
  save: (values, latest) => saveSettings({
    insurance_visibility: values.insurance_visibility,
    insurance_expiry_alert_days: values.insurance_expiry_alert_days!,
    insurance_require_dependent_id: values.insurance_require_dependent_id,
    revision: latest.revision,
  }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const visibilityItems = computed(() => (['own_enrollment_and_dependents', 'own_enrollment_only'] as const).map(value => ({ value, label: t(`hrInsurance.settings.visibilityOption.${value}`) })))
const validDays = computed(() => {
  const days = draft.value.insurance_expiry_alert_days
  return Number.isInteger(days) && days! >= ALERT_DAYS.min && days! <= ALERT_DAYS.max
})
const daysError = computed(() => validDays.value ? undefined : t('hrInsurance.settings.alertDaysInvalid', ALERT_DAYS))
async function submit() {
  if (!hydrated.value || !props.canEdit || !validDays.value) return
  await save()
}
</script>

<template>
  <SharedSettingsCard id="insurance-policy" v-bind="state" :title="t('hrInsurance.settings.title')" :description="t('hrInsurance.settings.hint')" :can-edit="canEdit" data-testid="hr-insurance-settings" @save="submit" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('hrInsurance.settings.visibility')" name="insurance-visibility" :description="t('hrInsurance.settings.visibilityHint')">
      <USelect id="insurance-visibility" v-model="draft.insurance_visibility" class="w-full" :items="visibilityItems" :disabled="locked" data-testid="hr-insurance-visibility" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('hrInsurance.settings.alertDays')" name="insurance-alert-days" :description="t('hrInsurance.settings.alertDaysHint')" :error="daysError">
      <UInputNumber id="insurance-alert-days" v-model="draft.insurance_expiry_alert_days" class="w-full" :min="ALERT_DAYS.min" :max="ALERT_DAYS.max" :step="1" :disabled="locked" data-testid="hr-insurance-alert-days" />
    </UFormField>
    <UFormField orientation="horizontal" name="insurance-require-id">
      <USwitch v-model="draft.insurance_require_dependent_id" :label="t('hrInsurance.settings.requireId')" :description="t('hrInsurance.settings.requireIdHint')" :disabled="locked" data-testid="hr-insurance-require-id" />
    </UFormField>
  </SharedSettingsCard>
</template>
