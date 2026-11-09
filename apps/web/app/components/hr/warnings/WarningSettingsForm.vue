<script setup lang="ts">
import type { HrWarningSettings } from '@liwan/contracts'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// The three warning policies of the company: who issues, whether the employee answers, and the escalation window.
// It saves with the revision the manager read: a save after someone else's answers 409, keeps the draft and locks the
// card until the current policy is reloaded. A window outside one to sixty months is told at its field and not sent.
const props = defineProps<{ settings: HrWarningSettings; canEdit: boolean; reloadSettings: () => Promise<HrWarningSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: saveSettings } = usePatchHrWarningSettings()

const WINDOW_MONTHS = { min: 1, max: 60 }
type Draft = {
  warnings_issued_by: HrWarningSettings['warnings_issued_by']
  warnings_employee_acknowledgement: HrWarningSettings['warnings_employee_acknowledgement']
  warnings_escalation_window_months: number | undefined
}
const { draft, state, save, revert, reload } = useSettingsForm<HrWarningSettings, Draft>({
  source: () => props.settings,
  read: ({ warnings_issued_by, warnings_employee_acknowledgement, warnings_escalation_window_months }) =>
    ({ warnings_issued_by, warnings_employee_acknowledgement, warnings_escalation_window_months }),
  save: (values, latest) => saveSettings({
    warnings_issued_by: values.warnings_issued_by,
    warnings_employee_acknowledgement: values.warnings_employee_acknowledgement,
    warnings_escalation_window_months: values.warnings_escalation_window_months!,
    revision: latest.revision,
  }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading || state.value.conflict)
const issuedByItems = computed(() => (['hr_only', 'manager_and_hr'] as const).map(value => ({ value, label: t(`hrWarnings.settings.issuedByOption.${value}`) })))
const acknowledgementItems = computed(() => (['required', 'optional', 'off'] as const).map(value => ({ value, label: t(`hrWarnings.settings.acknowledgementOption.${value}`) })))
const validWindow = computed(() => {
  const months = draft.value.warnings_escalation_window_months
  return Number.isInteger(months) && months! >= WINDOW_MONTHS.min && months! <= WINDOW_MONTHS.max
})
const windowError = computed(() => validWindow.value ? undefined : t('hrWarnings.settings.windowInvalid', WINDOW_MONTHS))
async function submit() {
  if (!hydrated.value || !props.canEdit || !validWindow.value) return
  await save()
}
</script>

<template>
  <SharedSettingsCard id="warning-policy" v-bind="state" :title="t('hrWarnings.settings.title')" :description="t('hrWarnings.settings.hint')" :can-edit="canEdit" data-testid="hr-warning-settings" @save="submit" @revert="revert" @reload="reload">
    <SharedSettingRow :label="t('hrWarnings.settings.issuedBy')" name="warning-issued-by">
      <USelect id="warning-issued-by" v-model="draft.warnings_issued_by" class="w-full" :items="issuedByItems" :disabled="locked" data-testid="hr-warning-issued-by" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('hrWarnings.settings.acknowledgement')" name="warning-acknowledgement">
      <USelect id="warning-acknowledgement" v-model="draft.warnings_employee_acknowledgement" class="w-full" :items="acknowledgementItems" :disabled="locked" data-testid="hr-warning-acknowledgement" />
    </SharedSettingRow>
    <UFormField orientation="horizontal" :label="t('hrWarnings.settings.window')" name="warning-window" :description="t('hrWarnings.settings.windowHint')" :error="windowError">
      <UInputNumber id="warning-window" v-model="draft.warnings_escalation_window_months" class="w-full" :min="WINDOW_MONTHS.min" :max="WINDOW_MONTHS.max" :step="1" :disabled="locked" data-testid="hr-warning-window" />
    </UFormField>
  </SharedSettingsCard>
</template>
