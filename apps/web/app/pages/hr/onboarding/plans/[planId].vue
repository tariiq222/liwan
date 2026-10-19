<script setup lang="ts">
import PlanForm from '@/components/hr/lifecycle/PlanForm.vue'
import { useHrOnboardingPlan } from '@/composables/useHrOnboarding'
import { ApiError } from '@/composables/useApi'

const NAMESPACE = 'hrOnboarding'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const planId = computed(() => Number(route.params.planId))
const validId = computed(() => Number.isSafeInteger(planId.value) && planId.value > 0)
const query = useHrOnboardingPlan(computed(() => validId.value ? planId.value : null))
const plan = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t(`hrOnboarding.errors.notFound`))))
const backTo = computed(() => typeof route.query.returnTo === 'string' && route.query.returnTo.startsWith('/') ? route.query.returnTo : '/hr/onboarding/plans')
const exportedSteps = computed(() => plan.value?.steps.length ?? 0)
const { mutateAsync: patchPlan, isPending: saving } = usePatchHrOnboardingPlan()
const toggleError = ref<unknown>(null)
const askingToggle = ref(false)
function saved() { toggleError.value = null }
async function confirmToggle() {
  if (!plan.value || !hydrated.value || !can('hr.onboarding.manage') || saving.value) return
  try {
    await patchPlan({ id: plan.value.id, patch: { active: !plan.value.active } })
    toggleError.value = null
    askingToggle.value = false
  } catch (error) {
    toggleError.value = error
  }
}
</script>

<template>
  <SharedRecordPage
    :keep-content="!!plan"
    :title="plan?.name || t(`hrOnboarding.plans.title`)"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="plan && can('hr.onboarding.manage')" #actions>
      <UButton
        color="neutral"
        variant="outline"
        :icon="plan.active ? 'i-lucide-circle-slash' : 'i-lucide-circle-check'"
        :disabled="!hydrated || saving"
        :label="plan.active ? t(`hrOnboarding.plans.deactivate`) : t(`hrOnboarding.plans.activate`)"
        @click="askingToggle = true"
      />
    </template>
    <SharedInlineConfirm
      v-if="plan && askingToggle"
      :title="t(`hrOnboarding.plans.deactivateTitle`)"
      :description="toggleError ? t(`hrOnboarding.form.saveError`) : t(`hrOnboarding.plans.deactivateDescription`)"
      :confirm-label="plan.active ? t(`hrOnboarding.plans.deactivate`) : t(`hrOnboarding.plans.activate`)"
      :pending="saving"
      @confirm="confirmToggle"
      @cancel="askingToggle = false"
    />
    <SharedIdentityCard v-if="plan" :id="plan.id" :name="plan.name" :subtitle="plan.department?.name || t(`hrOnboarding.form.anyDepartment`)">
      <template #badge>
        <SharedStatusBadge size="sm" :tone="plan.active ? 'success' : 'neutral'" :label="t(`hrOnboarding.form.active`)" />
      </template>
    </SharedIdentityCard>
    <PlanForm v-if="plan && can('hr.onboarding.manage')" area="onboarding" :namespace="NAMESPACE" :plan="plan" :back-to="backTo" @saved="saved" />
    <template v-if="plan" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t(`hrOnboarding.plans.steps`)" :value="exportedSteps" />
        <SharedPropertyRow :label="t(`hrOnboarding.form.department`)" :value="plan.department?.name || t(`hrOnboarding.form.anyDepartment`)" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
