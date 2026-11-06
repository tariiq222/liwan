<script setup lang="ts">
import { HrPayrollSettingsPatchSchema, type HrPayrollSettings, type HrPayrollStructure, type HrRef } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { payrollSettingsPatch, type PayrollSettingsDraft } from '@/utils/payrollSettings'
import { payrollFieldError } from '@/utils/payrollErrors'

// The general payroll settings of the company: the day divisor of a month's pay, the leave types that are unpaid, the
// annual leave type and the salary structure picked from the company's own. It sends only the fields the user changed,
// with the revision the manager read: a save after someone else's answers 409, keeps the draft and locks the card until
// the current settings are reloaded. A refusal the server attributed to a field is shown under that field, so the card
// keeps only the plain failure.
const props = defineProps<{
  settings: HrPayrollSettings
  /** The leave types the company defines, for the two leave pickers. */
  leaveTypes: HrRef[]
  /** The payroll structures of the company, for the structure picker. */
  structures: HrPayrollStructure[]
  canEdit: boolean
  reloadSettings: () => Promise<HrPayrollSettings>
}>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: saveSettings } = usePatchHrPayrollSettings()

const DAY_DIVISORS = [28, 29, 30, 31]

// What the server refused about one of these fields on the last save.
const refused = ref<unknown>(null)
const { draft, state, save, revert, reload } = useSettingsForm<HrPayrollSettings, PayrollSettingsDraft>({
  source: () => props.settings,
  read: settings => ({
    dayDivisor: String(settings.day_divisor),
    unpaidLeaveTypes: settings.unpaid_leave_types.map(type => String(type.id)),
    annualLeaveType: settings.annual_leave_type ? String(settings.annual_leave_type.id) : undefined,
    structure: settings.structure ? String(settings.structure.id) : undefined,
  }),
  save: async (values, latest) => {
    refused.value = null
    const changes = payrollSettingsPatch(latest, values)
    if (!Object.keys(changes).length) return latest
    try {
      return await saveSettings({ ...changes, revision: latest.revision })
    } catch (error) {
      refused.value = error
      // The field carries the sentence; the card says only that the save failed.
      throw error instanceof ApiError && error.field ? new ApiError(error.status, error.code, '', error.field, error.details) : error
    }
  },
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading || state.value.conflict)

const divisorOptions = DAY_DIVISORS.map(value => ({ value: String(value), label: String(value) }))
// The structure on record is always an option, so the picker shows it even when the list has not loaded.
const structureItems = computed(() => {
  const items = props.structures.map(item => ({ value: String(item.id), label: item.name }))
  const current = props.settings.structure
  return current && !items.some(item => item.value === String(current.id)) ? [{ value: String(current.id), label: current.name }, ...items] : items
})
const unpaidItems = computed(() => props.leaveTypes.map(type => ({ value: String(type.id), label: type.name })))
const annualItems = computed(() => props.leaveTypes.map(type => ({ value: String(type.id), label: type.name })))

const fieldError = (field: string) => payrollFieldError(refused.value, t, field)
const submit = () => {
  if (locked.value) return
  // The pickers cannot produce an out-of-contract draft; this guards the contract before anything is sent.
  const changes = payrollSettingsPatch(props.settings, draft.value)
  if (!HrPayrollSettingsPatchSchema.safeParse({ ...changes, revision: props.settings.revision }).success) return
  return save()
}
</script>

<template>
  <SharedSettingsCard id="payroll-general" v-bind="state" :title="t('hrPayroll.settings.generalTitle')" :description="t('hrPayroll.settings.generalHint')" :can-edit="canEdit" data-testid="hr-payroll-settings-form" @save="submit" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('hrPayroll.settings.dayDivisor')" name="hr-payroll-divisor" :description="t('hrPayroll.settings.dayDivisorHint')" :error="fieldError('day_divisor')">
      <USelect id="hr-payroll-divisor" v-model="draft.dayDivisor" class="w-full" :items="divisorOptions" :disabled="locked" data-testid="hr-payroll-divisor" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('hrPayroll.settings.structure')" name="hr-payroll-structure" :description="t('hrPayroll.settings.structureHint')" :error="fieldError('structure_id')">
      <USelect id="hr-payroll-structure" v-model="draft.structure" class="w-full" :items="structureItems" :placeholder="t('hrPayroll.settings.chooseStructure')" :disabled="locked" data-testid="hr-payroll-structure" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('hrPayroll.settings.annualLeaveType')" name="hr-payroll-annual" required :description="t('hrPayroll.settings.annualLeaveTypeHint')" :error="fieldError('annual_leave_type_id')">
      <USelect id="hr-payroll-annual" v-model="draft.annualLeaveType" class="w-full" :items="annualItems" :placeholder="t('hrPayroll.settings.chooseAnnualLeave')" :disabled="locked" data-testid="hr-payroll-annual" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('hrPayroll.settings.unpaidLeaveTypes')" name="hr-payroll-unpaid" :description="t('hrPayroll.settings.unpaidLeaveTypesHint')" :error="fieldError('unpaid_leave_type_ids')">
      <UCheckboxGroup v-model="draft.unpaidLeaveTypes" :items="unpaidItems" :disabled="locked" data-testid="hr-payroll-unpaid" />
    </UFormField>
  </SharedSettingsCard>
</template>
