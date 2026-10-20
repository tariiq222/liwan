<script setup lang="ts">
import { useHrOnboardingPlans, useLaunchHrOnboardingRun } from '@/composables/useHrOnboarding'
import { useHrEmployees } from '@/composables/useHrEmployees'
import { saveErrorMessage } from '@/utils/formFeedback'
import { owningListBack } from '@/utils/recordListOrigin'

const NAMESPACE = 'hrOnboarding'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const formError = ref<unknown>(null)
const errorMessage = computed(() => formError.value ? saveErrorMessage(formError.value, t(`${NAMESPACE}.form.saveError`), t('errors.saveUncertain')) : undefined)
const employees = useHrEmployees({ limit: 200, offset: 0 })
const plans = useHrOnboardingPlans({ active: 'true', limit: 200, offset: 0 }, computed(() => can('hr.onboarding.read')))
// «Start onboarding» after a hire arrives here with the new employee already chosen.
const queryEmployeeId = Number(route.query.employee_id)
const employeeId = ref<number | null>(Number.isSafeInteger(queryEmployeeId) && queryEmployeeId > 0 ? queryEmployeeId : null)
const planId = ref<number | null>(null)
const planDate = ref<string | null>(null)
const employeeError = ref<string>()
const planError = ref<string>()
const employeeOptions = computed(() => (employees.data.value?.items ?? []).map(employee => ({ value: String(employee.id), label: employee.name })))
const planOptions = computed(() => (plans.data.value?.items ?? []).map(plan => ({ value: String(plan.id), label: plan.name })))
const { mutateAsync: launch, isPending } = useLaunchHrOnboardingRun()
const sourcePaths = useRecordListPaths(['/hr/onboarding'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
let submitting = false
async function submit() {
  if (!can('hr.onboarding.manage') || !hydrated.value || isPending.value || submitting) return
  employeeError.value = undefined
  planError.value = undefined
  if (!employeeId.value) { employeeError.value = t(`${NAMESPACE}.form.employeeRequired`); return }
  if (!planId.value) { planError.value = t(`${NAMESPACE}.runs.planRequired`); return }
  submitting = true
  try {
    const run = await launch({ employee_id: employeeId.value, plan_id: planId.value, plan_date: planDate.value ?? undefined })
    formError.value = null
    await navigateTo({ path: `/hr/onboarding/${run.id}` }, { replace: true })
  } catch (error) {
    formError.value = error
  } finally { submitting = false }
}
</script>

<template>
  <SharedCreatePanel :title="t(`${NAMESPACE}.runs.new`)" :back-to="backTo">
    <SharedPageState v-if="!can('hr.onboarding.manage')" :empty="true" :empty-text="t(`${NAMESPACE}.errors.forbidden`)" />
    <UForm v-else :state="{ employeeId, planId, planDate }" class="webvue-form" method="post" :loading-auto="false" novalidate @submit="submit">
      <UAlert v-if="formError" role="alert" color="error" variant="subtle" :title="t(`${NAMESPACE}.form.saveError`)" :description="errorMessage" />
      <SharedFormSection panel :title="t(`${NAMESPACE}.runs.title`)">
        <div class="webvue-form-grid">
          <UFormField :label="t(`${NAMESPACE}.form.employee`)" name="hr-onboarding-employee" required :error="employeeError">
            <USelect
              id="hr-onboarding-employee"
              class="w-full"
              :model-value="employeeId ? String(employeeId) : undefined"
              :items="employeeOptions"
              :placeholder="t(`${NAMESPACE}.form.employeePlaceholder`)"
              :disabled="!hydrated || isPending"
              @update:model-value="employeeId = $event ? Number($event) : null"
            />
          </UFormField>
          <UFormField :label="t(`${NAMESPACE}.runs.plan`)" name="hr-onboarding-plan" required :error="planError">
            <USelect
              id="hr-onboarding-plan"
              class="w-full"
              :model-value="planId ? String(planId) : undefined"
              :items="planOptions"
              :disabled="!hydrated || isPending"
              @update:model-value="planId = $event ? Number($event) : null"
            />
          </UFormField>
          <UFormField :label="t(`${NAMESPACE}.runs.planDate`)" name="hr-onboarding-date">
            <SharedDateField id="hr-onboarding-date" v-model="planDate" class="w-full" :disabled="!hydrated || isPending" />
          </UFormField>
        </div>
      </SharedFormSection>
      <SharedFormActions>
        <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t('app.create')" />
      </SharedFormActions>
    </UForm>
  </SharedCreatePanel>
</template>
