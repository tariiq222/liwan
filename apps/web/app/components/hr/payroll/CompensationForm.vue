<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { HrCompensationWriteSchema, type HrCompensation } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'

// The compensation editor of one employee. The bank on record is kept as it is (there is no bank
// catalog route), and the nationality is read-only: the server derives it from the employee record.
const props = defineProps<{
  employeeId: number
  compensation: HrCompensation | null
  backTo: RouteLocationRaw
}>()
const emit = defineEmits<{ saved: [compensation: HrCompensation] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: save, isPending } = useSaveHrCompensation(() => props.employeeId)

const basicWage = ref('')
const housingAllowance = ref('')
const transportAllowance = ref('')
const otherAllowance = ref('')
const iban = ref('')
const gosiNumber = ref('')
const gosiRegistrationDate = ref<string | null>(null)
const savedState = ref('')
const attempted = ref(false)
const formError = ref<unknown>(null)

const amountText = (value: number | undefined) => value === undefined ? '' : String(value)
const state = () => JSON.stringify([basicWage.value, housingAllowance.value, transportAllowance.value, otherAllowance.value, iban.value, gosiNumber.value, gosiRegistrationDate.value])
const dirty = computed(() => savedState.value !== state())

watch(() => props.compensation, (record) => {
  basicWage.value = amountText(record?.basic_wage)
  housingAllowance.value = amountText(record?.housing_allowance ?? 0)
  transportAllowance.value = amountText(record?.transport_allowance ?? 0)
  otherAllowance.value = amountText(record?.other_allowance ?? 0)
  iban.value = record?.iban ?? ''
  gosiNumber.value = record?.gosi_number ?? ''
  gosiRegistrationDate.value = record?.gosi_registration_date ?? null
  savedState.value = state()
}, { immediate: true })

const compactIban = () => iban.value.replace(/\s+/g, '').toUpperCase()
const parseAmount = (text: string) => text.trim() === '' ? Number.NaN : Number(text)
const body = computed(() => ({
  basic_wage: parseAmount(basicWage.value),
  housing_allowance: parseAmount(housingAllowance.value),
  transport_allowance: parseAmount(transportAllowance.value),
  other_allowance: parseAmount(otherAllowance.value),
  iban: compactIban() || null,
  bank_id: props.compensation?.bank?.id ?? null,
  gosi_number: gosiNumber.value.trim() || null,
  gosi_registration_date: gosiRegistrationDate.value,
}))
const parsed = computed(() => HrCompensationWriteSchema.safeParse(body.value))
function invalid(key: keyof typeof body.value) {
  return !parsed.value.success && parsed.value.error.issues.some(issue => issue.path[0] === key)
}
function fieldError(key: keyof typeof body.value, message: string) {
  if (attempted.value && invalid(key)) return message
  return formError.value instanceof ApiError && formError.value.field === key ? formError.value.message : undefined
}
const errorMessage = computed(() => formError.value ? saveErrorMessage(formError.value, t('errors.generic'), t('errors.saveUncertain')) : undefined)
const showAlert = computed(() => !!formError.value && !(formError.value instanceof ApiError && formError.value.field))

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  formError.value = null
  if (!parsed.value.success) return
  try {
    const record = await save(parsed.value.data)
    savedState.value = state()
    emit('saved', record)
    toast.add({ title: t('hrPayroll.compensation.saved'), color: 'success' })
  } catch (error) { formError.value = error }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="{ basicWage, housingAllowance, transportAllowance, otherAllowance, iban, gosiNumber, gosiRegistrationDate }" class="webvue-form" method="post" novalidate data-testid="hr-compensation-form" @submit="submit">
    <UAlert v-if="showAlert" role="alert" color="error" variant="subtle" :title="t('hrPayroll.compensation.saveError')" :description="errorMessage" />
    <SharedFormSection panel :title="t('hrPayroll.compensation.wageSection')" :description="t('hrPayroll.compensation.wageHint')">
      <div class="webvue-form-grid">
        <UFormField :label="t('hrPayroll.compensation.basicWage')" name="hr-compensation-basic" required :error="fieldError('basic_wage', t('hrPayroll.compensation.basicWageInvalid'))">
          <UInput id="hr-compensation-basic" v-model="basicWage" type="number" inputmode="decimal" min="0" step="0.01" class="w-full" :disabled="!hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hrPayroll.compensation.housingAllowance')" name="hr-compensation-housing" :error="fieldError('housing_allowance', t('hrPayroll.compensation.amountInvalid'))">
          <UInput id="hr-compensation-housing" v-model="housingAllowance" type="number" inputmode="decimal" min="0" step="0.01" class="w-full" :disabled="!hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hrPayroll.compensation.transportAllowance')" name="hr-compensation-transport" :error="fieldError('transport_allowance', t('hrPayroll.compensation.amountInvalid'))">
          <UInput id="hr-compensation-transport" v-model="transportAllowance" type="number" inputmode="decimal" min="0" step="0.01" class="w-full" :disabled="!hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hrPayroll.compensation.otherAllowance')" name="hr-compensation-other" :error="fieldError('other_allowance', t('hrPayroll.compensation.amountInvalid'))">
          <UInput id="hr-compensation-other" v-model="otherAllowance" type="number" inputmode="decimal" min="0" step="0.01" class="w-full" :disabled="!hydrated || isPending" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('hrPayroll.compensation.bankSection')" :description="t('hrPayroll.compensation.bankHint')">
      <div class="webvue-form-grid">
        <UFormField :label="t('hrPayroll.compensation.iban')" name="hr-compensation-iban" :error="fieldError('iban', t('hrPayroll.compensation.ibanInvalid'))">
          <UInput id="hr-compensation-iban" v-model="iban" dir="ltr" class="w-full" :placeholder="t('hrPayroll.compensation.ibanPlaceholder')" :disabled="!hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hrPayroll.compensation.bank')" name="hr-compensation-bank" :help="t('hrPayroll.compensation.bankKept')" :error="fieldError('bank_id', t('errors.generic'))">
          <UInput id="hr-compensation-bank" class="w-full" :model-value="compensation?.bank?.name ?? ''" readonly disabled />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('hrPayroll.compensation.gosiSection')">
      <div class="webvue-form-grid">
        <UFormField :label="t('hrPayroll.compensation.gosiNumber')" name="hr-compensation-gosi" :error="fieldError('gosi_number', t('errors.generic'))">
          <UInput id="hr-compensation-gosi" v-model="gosiNumber" dir="ltr" class="w-full" :disabled="!hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hrPayroll.compensation.gosiRegistrationDate')" name="hr-compensation-gosi-date" :error="fieldError('gosi_registration_date', t('errors.generic'))">
          <SharedDateField id="hr-compensation-gosi-date" v-model="gosiRegistrationDate" :disabled="!hydrated || isPending" />
        </UFormField>
        <UFormField :label="t('hrPayroll.compensation.nationality')" name="hr-compensation-nationality" :help="t('hrPayroll.compensation.nationalityHint')">
          <UInput id="hr-compensation-nationality" class="w-full" :model-value="compensation?.nationality?.name ?? ''" readonly disabled />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <span class="me-auto text-xs text-muted">{{ t('hrPayroll.compensation.formHint') }}</span>
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t('app.saveChanges')" data-testid="hr-compensation-submit" />
    </SharedFormActions>
  </UForm>
</template>
