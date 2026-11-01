<script setup lang="ts">
import { HrPayrollSettingsPatchSchema, type HrPayrollSettings, type HrPayrollStructure, type HrRef } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'
import { payrollSettingsPatch } from '@/utils/payrollSettings'
import { payrollFieldError } from '@/utils/payrollErrors'

// The general payroll settings of the company: the day divisor of a month's pay, the leave types that are unpaid, and
// the annual leave type, and the salary structure picked from the company's own. The component owns its write and sends only the fields the user changed, with the revision its draft started from: a
// save after someone else's answers 409, keeps the draft and offers an explicit reload.
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
const { mutateAsync: save, isPending } = usePatchHrPayrollSettings()

const DAY_DIVISORS = [28, 29, 30, 31]

// Keep the settings the draft started from: a background refetch cannot silently make a stale draft current.
const baseline = ref(props.settings)
const dayDivisor = ref(String(props.settings.day_divisor))
const structure = ref<string | undefined>(props.settings.structure ? String(props.settings.structure.id) : undefined)
const unpaidLeaveTypes = ref(props.settings.unpaid_leave_types.map(type => String(type.id)))
const annualLeaveType = ref<string | undefined>(props.settings.annual_leave_type ? String(props.settings.annual_leave_type.id) : undefined)

const patch = computed(() => payrollSettingsPatch(baseline.value, {
  dayDivisor: dayDivisor.value, unpaidLeaveTypes: unpaidLeaveTypes.value, annualLeaveType: annualLeaveType.value, structure: structure.value,
}))
const dirty = computed(() => Object.keys(patch.value).length > 0)
function seed(settings: HrPayrollSettings) {
  baseline.value = settings
  dayDivisor.value = String(settings.day_divisor)
  structure.value = settings.structure ? String(settings.structure.id) : undefined
  unpaidLeaveTypes.value = settings.unpaid_leave_types.map(type => String(type.id))
  annualLeaveType.value = settings.annual_leave_type ? String(settings.annual_leave_type.id) : undefined
}
const { failure, conflict, reloading, reloadFailure, reload } = usePayrollConflict(() => props.reloadSettings(), seed)
// A background refetch must not discard unsaved edits: re-seed only a form that has no changes and no conflict.
watch(() => props.settings, (settings) => { if (!dirty.value && !conflict.value && !reloading.value) seed(settings) })

const divisorOptions = DAY_DIVISORS.map(value => ({ value: String(value), label: String(value) }))
// The structure on record is always an option, so the picker shows it even when the list has not loaded.
const structureItems = computed(() => {
  const items = props.structures.map(item => ({ value: String(item.id), label: item.name }))
  const current = props.settings.structure
  return current && !items.some(item => item.value === String(current.id)) ? [{ value: String(current.id), label: current.name }, ...items] : items
})
const unpaidItems = computed(() => props.leaveTypes.map(type => ({ value: String(type.id), label: type.name })))
const annualItems = computed(() => props.leaveTypes.map(type => ({ value: String(type.id), label: type.name })))

const serverField = computed(() => failure.value instanceof ApiError ? failure.value.field : undefined)
const alertMessage = computed(() => {
  if (conflict.value) return t('hrPayroll.revision.conflict')
  return failure.value && !serverField.value ? saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain')) : undefined
})
const locked = computed(() => !hydrated.value || !props.canEdit || isPending.value || reloading.value)
const fieldError = (field: string) => payrollFieldError(failure.value, t, field)

async function submit() {
  if (!hydrated.value || isPending.value || reloading.value || !props.canEdit || !dirty.value || conflict.value) return
  failure.value = null
  const parsed = HrPayrollSettingsPatchSchema.safeParse({ ...patch.value, revision: baseline.value.revision })
  if (!parsed.success) return
  try {
    seed(await save(parsed.data))
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm novalidate :state="{ dayDivisor, structure, unpaidLeaveTypes, annualLeaveType }" class="liwan-form" method="post" data-testid="hr-payroll-settings-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="alertMessage" role="alert" color="error" variant="subtle" :title="t('hrPayroll.settings.saveError')" :description="alertMessage" />
    <UButton v-if="conflict" color="neutral" variant="outline" :label="t('hrPayroll.revision.reload')" :loading="reloading" :disabled="!hydrated || reloading" data-testid="hr-payroll-settings-reload" @click="reload" />
    <UAlert v-if="reloadFailure" role="alert" color="error" variant="subtle" :title="t('hrPayroll.revision.reloadError')" />
    <SharedFormSection panel :title="t('hrPayroll.settings.generalTitle')" :description="t('hrPayroll.settings.generalHint')">
      <div class="liwan-form-grid">
        <UFormField :label="t('hrPayroll.settings.dayDivisor')" name="hr-payroll-divisor" :help="t('hrPayroll.settings.dayDivisorHint')" :error="fieldError('day_divisor')">
          <USelect id="hr-payroll-divisor" v-model="dayDivisor" class="w-full" :items="divisorOptions" :disabled="locked" data-testid="hr-payroll-divisor" />
        </UFormField>
        <UFormField :label="t('hrPayroll.settings.structure')" name="hr-payroll-structure" :help="t('hrPayroll.settings.structureHint')" :error="fieldError('structure_id')">
          <USelect id="hr-payroll-structure" v-model="structure" class="w-full" :items="structureItems" :placeholder="t('hrPayroll.settings.chooseStructure')" :disabled="locked" data-testid="hr-payroll-structure" />
        </UFormField>
        <UFormField :label="t('hrPayroll.settings.annualLeaveType')" name="hr-payroll-annual" required :help="t('hrPayroll.settings.annualLeaveTypeHint')" :error="fieldError('annual_leave_type_id')">
          <USelect id="hr-payroll-annual" v-model="annualLeaveType" class="w-full" :items="annualItems" :placeholder="t('hrPayroll.settings.chooseAnnualLeave')" :disabled="locked" data-testid="hr-payroll-annual" />
        </UFormField>
        <UFormField :label="t('hrPayroll.settings.unpaidLeaveTypes')" name="hr-payroll-unpaid" :help="t('hrPayroll.settings.unpaidLeaveTypesHint')" :error="fieldError('unpaid_leave_type_ids')">
          <UCheckboxGroup v-model="unpaidLeaveTypes" :items="unpaidItems" :disabled="locked" data-testid="hr-payroll-unpaid" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions v-if="props.canEdit">
      <UButton type="submit" color="primary" class="ms-auto" :disabled="locked || !dirty || conflict" :loading="isPending" :label="t('app.saveChanges')" data-testid="hr-payroll-settings-submit" />
    </SharedFormActions>
  </UForm>
</template>
