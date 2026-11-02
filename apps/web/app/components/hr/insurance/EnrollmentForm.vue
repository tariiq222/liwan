<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { HrInsuranceEnrollmentDetail, HrInsurancePlan } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import EmployeeSearchSelect from '@/components/hr/EmployeeSearchSelect.vue'

// The create form of one enrollment, inside the /hr/insurance/enrollments/new SharedCreatePanel. It posts the exact
// request body and reports the created record; the page owns the navigation. An empty end date runs to the end of the plan.
const props = defineProps<{
  plans: HrInsurancePlan[]
  backTo: RouteLocationRaw
}>()
const emit = defineEmits<{ saved: [enrollment: HrInsuranceEnrollmentDetail] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: createEnrollment, isPending } = useCreateHrInsuranceEnrollment()

const employeeId = ref<number | null>(null)
const planId = ref<number | null>(null)
const memberNumber = ref('')
const dateFrom = ref<string | null>(null)
const dateTo = ref<string | null>(null)
const employeeShare = ref<number | undefined>()
const companyShare = ref<number | undefined>()
const notes = ref('')
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')

const planOptions = computed(() => props.plans.map(plan => ({ value: String(plan.id), label: `${plan.name} · ${plan.provider.name}` })))
const chosenPlan = computed(() => props.plans.find(plan => plan.id === planId.value))
const dirty = computed(() => !saved.value && Boolean(employeeId.value || planId.value || memberNumber.value || dateFrom.value || dateTo.value || employeeShare.value !== undefined || companyShare.value !== undefined || notes.value))

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}
const employeeError = computed(() => attempted.value && !employeeId.value ? t('hrInsurance.form.employeeRequired') : fieldError('employee_id'))
const planError = computed(() => attempted.value && !planId.value ? t('hrInsurance.form.planRequired') : fieldError('plan_id'))
const dateError = computed(() => attempted.value && !dateFrom.value ? t('hrInsurance.form.dateRequired') : fieldError('date_from') ?? fieldError('date_to'))

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!employeeId.value || !planId.value || !dateFrom.value) return
  try {
    const enrollment = await createEnrollment({
      employee_id: employeeId.value,
      plan_id: planId.value,
      member_number: memberNumber.value.trim() || undefined,
      date_from: dateFrom.value,
      date_to: dateTo.value ?? undefined,
      employee_share: employeeShare.value,
      company_share: companyShare.value,
      notes: notes.value.trim() || undefined,
    })
    saved.value = true
    await nextTick()
    emit('saved', enrollment)
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
    serverField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <UForm novalidate :state="{ employeeId, planId, memberNumber, dateFrom, dateTo, employeeShare, companyShare, notes }" class="liwan-form" method="post" data-testid="hr-insurance-enrollment-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />
    <SharedFormSection panel :title="t('hrInsurance.form.coverage')">
      <div class="grid gap-4">
        <UFormField :label="t('hrInsurance.form.employee')" name="hr-insurance-employee" required :error="employeeError">
          <EmployeeSearchSelect id="hr-insurance-employee" v-model="employeeId" :placeholder="t('hrInsurance.form.chooseEmployee')" :disabled="!hydrated || isPending" test-id="hr-insurance-employee" />
        </UFormField>
        <UFormField :label="t('hrInsurance.form.plan')" name="hr-insurance-plan" required :error="planError" :hint="planOptions.length ? undefined : t('hrInsurance.form.noPlans')">
          <USelect id="hr-insurance-plan" class="w-full" :model-value="planId ? String(planId) : undefined" :items="planOptions" :placeholder="t('hrInsurance.form.choosePlan')" :disabled="!hydrated || isPending" data-testid="hr-insurance-plan" @update:model-value="planId = $event ? Number($event) : null" />
        </UFormField>
        <p v-if="chosenPlan" class="text-sm text-muted" data-testid="hr-insurance-plan-validity">{{ t('hrInsurance.form.planValidity', { from: chosenPlan.valid_from, to: chosenPlan.valid_to }) }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('hrInsurance.form.dateFrom')" name="hr-insurance-date-from" required :error="dateError">
            <SharedDateField id="hr-insurance-date-from" v-model="dateFrom" :disabled="!hydrated || isPending" />
          </UFormField>
          <UFormField :label="t('hrInsurance.form.dateTo')" name="hr-insurance-date-to" :hint="t('hrInsurance.form.dateToHint')">
            <SharedDateField id="hr-insurance-date-to" v-model="dateTo" :disabled="!hydrated || isPending" />
          </UFormField>
        </div>
        <UFormField :label="t('hrInsurance.form.memberNumber')" name="hr-insurance-member-number" :hint="t('hrInsurance.form.memberNumberHint')">
          <UInput id="hr-insurance-member-number" v-model="memberNumber" class="w-full" dir="ltr" :disabled="!hydrated || isPending" data-testid="hr-insurance-member-number" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('hrInsurance.form.shares')" :description="t('hrInsurance.form.sharesHint')">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="t('hrInsurance.form.employeeShare')" name="hr-insurance-employee-share">
          <UInputNumber id="hr-insurance-employee-share" v-model="employeeShare" class="w-full" :min="0" :disabled="!hydrated || isPending" data-testid="hr-insurance-employee-share" />
        </UFormField>
        <UFormField :label="t('hrInsurance.form.companyShare')" name="hr-insurance-company-share">
          <UInputNumber id="hr-insurance-company-share" v-model="companyShare" class="w-full" :min="0" :disabled="!hydrated || isPending" data-testid="hr-insurance-company-share" />
        </UFormField>
      </div>
      <UFormField :label="t('hrInsurance.form.notes')" name="hr-insurance-notes">
        <UTextarea id="hr-insurance-notes" v-model="notes" class="w-full" :rows="3" :disabled="!hydrated || isPending" data-testid="hr-insurance-notes" />
      </UFormField>
    </SharedFormSection>
    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('hrInsurance.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t('hrInsurance.form.submitEnrollment')" data-testid="hr-insurance-enrollment-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
