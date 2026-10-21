<script setup lang="ts">
import { HrPayrollSettingsPatchSchema, type HrPayrollSettings, type HrRef } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'
import { payrollSettingsPatch } from '@/utils/payrollSettings'

// The general payroll settings of the company: the day divisor of a month's pay, the leave types that are unpaid, and
// the annual leave type. The salary structure is shown but not chosen here (no route lists the structures). The
// component owns its write and sends only the fields the user changed.
const props = defineProps<{
  settings: HrPayrollSettings
  /** The leave types the company defines, for the two leave pickers. */
  leaveTypes: HrRef[]
  canEdit: boolean
}>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending } = usePatchHrPayrollSettings()

const DAY_DIVISORS = [28, 29, 30, 31]

const dayDivisor = ref(String(props.settings.day_divisor))
const unpaidLeaveTypes = ref(props.settings.unpaid_leave_types.map(type => String(type.id)))
const annualLeaveType = ref<string | undefined>(props.settings.annual_leave_type ? String(props.settings.annual_leave_type.id) : undefined)
const failure = ref<unknown>(null)

const patch = computed(() => payrollSettingsPatch(props.settings, {
  dayDivisor: dayDivisor.value, unpaidLeaveTypes: unpaidLeaveTypes.value, annualLeaveType: annualLeaveType.value,
}))
const dirty = computed(() => Object.keys(patch.value).length > 0)
function seed(settings: HrPayrollSettings) {
  dayDivisor.value = String(settings.day_divisor)
  unpaidLeaveTypes.value = settings.unpaid_leave_types.map(type => String(type.id))
  annualLeaveType.value = settings.annual_leave_type ? String(settings.annual_leave_type.id) : undefined
}
// A background refetch must not discard unsaved edits: re-seed only a form that has no changes.
watch(() => props.settings, (settings) => { if (!dirty.value) seed(settings) })

const divisorOptions = DAY_DIVISORS.map(value => ({ value: String(value), label: String(value) }))
const unpaidItems = computed(() => props.leaveTypes.map(type => ({ value: String(type.id), label: type.name })))
const annualItems = computed(() => props.leaveTypes.map(type => ({ value: String(type.id), label: type.name })))

const serverField = computed(() => failure.value instanceof ApiError ? failure.value.field : undefined)
const alertMessage = computed(() => failure.value && !serverField.value
  ? saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))
  : undefined)
const fieldError = (field: string) => serverField.value === field && failure.value instanceof ApiError ? failure.value.message : undefined

async function submit() {
  if (!hydrated.value || isPending.value || !props.canEdit || !dirty.value) return
  failure.value = null
  const parsed = HrPayrollSettingsPatchSchema.safeParse(patch.value)
  if (!parsed.success) return
  try {
    seed(await save(parsed.data))
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm novalidate :state="{ dayDivisor, unpaidLeaveTypes, annualLeaveType }" class="webvue-form" method="post" data-testid="hr-payroll-settings-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="alertMessage" role="alert" color="error" variant="subtle" :title="t('hrPayroll.settings.saveError')" :description="alertMessage" />
    <SharedFormSection panel :title="t('hrPayroll.settings.generalTitle')" :description="t('hrPayroll.settings.generalHint')">
      <div class="webvue-form-grid">
        <UFormField :label="t('hrPayroll.settings.dayDivisor')" name="hr-payroll-divisor" :help="t('hrPayroll.settings.dayDivisorHint')" :error="fieldError('day_divisor')">
          <USelect id="hr-payroll-divisor" v-model="dayDivisor" class="w-full" :items="divisorOptions" :disabled="!hydrated || !props.canEdit || isPending" data-testid="hr-payroll-divisor" />
        </UFormField>
        <UFormField :label="t('hrPayroll.settings.structure')" name="hr-payroll-structure" :help="t('hrPayroll.settings.structureHint')" :error="fieldError('structure_id')">
          <UInput id="hr-payroll-structure" class="w-full" :model-value="props.settings.structure?.name ?? t('hrPayroll.settings.noStructure')" readonly disabled />
        </UFormField>
        <UFormField :label="t('hrPayroll.settings.annualLeaveType')" name="hr-payroll-annual" required :help="t('hrPayroll.settings.annualLeaveTypeHint')" :error="fieldError('annual_leave_type_id')">
          <USelect id="hr-payroll-annual" v-model="annualLeaveType" class="w-full" :items="annualItems" :placeholder="t('hrPayroll.settings.chooseAnnualLeave')" :disabled="!hydrated || !props.canEdit || isPending" data-testid="hr-payroll-annual" />
        </UFormField>
        <UFormField :label="t('hrPayroll.settings.unpaidLeaveTypes')" name="hr-payroll-unpaid" :help="t('hrPayroll.settings.unpaidLeaveTypesHint')" :error="fieldError('unpaid_leave_type_ids')">
          <UCheckboxGroup v-model="unpaidLeaveTypes" :items="unpaidItems" :disabled="!hydrated || !props.canEdit || isPending" data-testid="hr-payroll-unpaid" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions v-if="props.canEdit">
      <UButton type="submit" color="primary" class="ms-auto" :disabled="!hydrated || isPending || !dirty" :loading="isPending" :label="t('app.saveChanges')" data-testid="hr-payroll-settings-submit" />
    </SharedFormActions>
  </UForm>
</template>
