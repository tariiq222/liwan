<script setup lang="ts">
import RunSteps from '@/components/hr/lifecycle/RunSteps.vue'
import { useCompleteHrOnboardingStep, useHrOnboardingRun } from '@/composables/useHrOnboarding'
import { ApiError } from '@/composables/useApi'

const NAMESPACE = 'hrOnboarding'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const runId = computed(() => Number(route.params.runId))
const validId = computed(() => Number.isSafeInteger(runId.value) && runId.value > 0)
const query = useHrOnboardingRun(computed(() => validId.value ? runId.value : null))
const run = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t(`${NAMESPACE}.errors.notFound`))))
const backTo = computed(() => typeof route.query.returnTo === 'string' && route.query.returnTo.startsWith('/') ? route.query.returnTo : '/hr/onboarding')
const stepError = ref<unknown>(null)
const { mutateAsync: completeStep, isPending } = useCompleteHrOnboardingStep()
async function complete(stepId: number, feedback?: string) {
  if (!run.value || isPending.value) return
  try {
    await completeStep({ runId: run.value.id, stepId, feedback })
    stepError.value = null
  } catch (error) {
    stepError.value = error
  }
}
</script>

<template>
  <SharedRecordPage
    :keep-content="!!run"
    :title="run ? t(`${NAMESPACE}.runs.title`) : t(`${NAMESPACE}.title`)"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <SharedIdentityCard v-if="run" :id="run.id" :name="run.employee.name" :subtitle="run.plan.name">
      <template #badge>
        <SharedStatusBadge size="sm" :tone="run.state === 'done' ? 'success' : 'info'" :label="t(`${NAMESPACE}.states.${run.state}`)" />
      </template>
    </SharedIdentityCard>
    <UAlert v-if="stepError" role="alert" color="error" variant="subtle" :title="t(`${NAMESPACE}.form.saveError`)" />
    <SharedRecordSection v-if="run" :title="t(`${NAMESPACE}.run.steps`)">
      <RunSteps :run="run" :namespace="NAMESPACE" :pending="isPending" @complete="complete" />
    </SharedRecordSection>
    <template v-if="run" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t(`${NAMESPACE}.runs.planDate`)" :value="run.plan_date" />
        <SharedPropertyRow :label="t(`${NAMESPACE}.run.launchedBy`)" :value="run.launched_by.name" />
        <SharedPropertyRow :label="t(`${NAMESPACE}.runs.progress`)" :value="`${run.done} / ${run.total}`" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
