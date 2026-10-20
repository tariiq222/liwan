<script setup lang="ts">
import PlanForm from '@/components/hr/lifecycle/PlanForm.vue'
import { useHrOffboardingPlan } from '@/composables/useHrOffboarding'
import { ApiError } from '@/composables/useApi'

const NAMESPACE = 'hrOffboarding'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const planId = computed(() => Number(route.params.planId))
const validId = computed(() => Number.isSafeInteger(planId.value) && planId.value > 0)
const query = useHrOffboardingPlan(computed(() => validId.value ? planId.value : null))
const plan = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t(`hrOffboarding.errors.notFound`))))
const backTo = computed(() => typeof route.query.returnTo === 'string' && route.query.returnTo.startsWith('/') ? route.query.returnTo : '/hr/offboarding/plans')
const exportedSteps = computed(() => plan.value?.steps.length ?? 0)
const { mutateAsync: patchPlan, isPending: saving } = usePatchHrOffboardingPlan()
const toggleError = ref<unknown>(null)
const askingToggle = ref(false)
function saved() { toggleError.value = null }
async function confirmToggle() {
  if (!plan.value || !hydrated.value || !can('hr.offboarding.manage') || saving.value) return
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
    :title="plan?.name || t(`hrOffboarding.plans.title`)"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="plan && can('hr.offboarding.manage')" #actions>
      <UButton
        color="neutral"
        variant="outline"
        :icon="plan.active ? 'i-lucide-circle-slash' : 'i-lucide-circle-check'"
        :disabled="!hydrated || saving"
        :label="plan.active ? t(`hrOffboarding.plans.deactivate`) : t(`hrOffboarding.plans.activate`)"
        @click="askingToggle = true"
      />
    </template>
    <SharedInlineConfirm
      v-if="plan && askingToggle"
      :title="plan.active ? t(`hrOffboarding.plans.deactivateTitle`) : t(`hrOffboarding.plans.activateTitle`)"
      :description="toggleError ? t(`hrOffboarding.form.saveError`) : plan.active ? t(`hrOffboarding.plans.deactivateDescription`) : t(`hrOffboarding.plans.activateDescription`)"
      :confirm-label="plan.active ? t(`hrOffboarding.plans.deactivate`) : t(`hrOffboarding.plans.activate`)"
      :pending="saving"
      @confirm="confirmToggle"
      @cancel="askingToggle = false"
    />
    <SharedIdentityCard v-if="plan" :id="plan.id" :name="plan.name" :subtitle="plan.department?.name || t(`hrOffboarding.form.anyDepartment`)">
      <template #badge>
        <SharedStatusBadge size="sm" :tone="plan.active ? 'success' : 'neutral'" :label="plan.active ? t(`hrOffboarding.plans.statusActive`) : t(`hrOffboarding.plans.statusInactive`)" />
      </template>
    </SharedIdentityCard>
    <PlanForm v-if="plan && can('hr.offboarding.manage')" area="offboarding" :namespace="NAMESPACE" :plan="plan" :back-to="backTo" @saved="saved" />
    <template v-if="plan" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t(`hrOffboarding.plans.steps`)" :value="exportedSteps" />
        <SharedPropertyRow :label="t(`hrOffboarding.form.department`)" :value="plan.department?.name || t(`hrOffboarding.form.anyDepartment`)" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
