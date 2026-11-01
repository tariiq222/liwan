<script setup lang="ts">
import PlanForm from '@/components/hr/insurance/PlanForm.vue'
import { ApiError } from '@/composables/useApi'
import { isHrInsuranceConflict } from '@/composables/useHrInsurance'
import { owningListBack } from '@/utils/recordListOrigin'
import { hrInsurancePlanBadge } from '@/utils/hrInsurance'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/insurance'])
const id = computed(() => Number(route.params.planId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const query = useHrInsurancePlan(computed(() => (validId.value ? id.value : null)))
const plan = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const providers = useHrInsuranceProviders('all')
const canManage = computed(() => can('hr.insurance.manage'))
const badge = computed(() => (plan.value ? hrInsurancePlanBadge(plan.value.state) : null))

const patch = usePatchHrInsurancePlan()
const archiving = ref(false)
const actionError = ref('')
async function toggleArchive() {
  const current = plan.value
  if (!current || !hydrated.value || patch.isPending.value) return
  actionError.value = ''
  try {
    await patch.mutateAsync({ id: current.id, body: { revision: current.revision, active: !current.active } })
    archiving.value = false
  } catch (cause) {
    actionError.value = isHrInsuranceConflict(cause) ? t('hrInsurance.conflict') : cause instanceof ApiError ? cause.message : t('errors.generic')
    archiving.value = false
  }
}
</script>

<template>
  <SharedRecordPage
    :keep-content="!!plan"
    :title="plan ? `${plan.name} · ${plan.provider.name}` : t('hrInsurance.section.plans')"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="plan && canManage && !archiving" #actions>
      <UButton color="neutral" variant="outline" :disabled="!hydrated || patch.isPending.value" :label="t(plan.active ? 'hrInsurance.plan.archive' : 'hrInsurance.plan.restore')" data-testid="hr-insurance-plan-archive" @click="archiving = true" />
    </template>

    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="t('hrInsurance.actions.error')" :description="actionError" />

    <SharedInlineConfirm
      v-if="archiving && plan"
      :title="t(plan.active ? 'hrInsurance.plan.archiveTitle' : 'hrInsurance.plan.restoreTitle')"
      :description="t(plan.active ? 'hrInsurance.plan.archiveHint' : 'hrInsurance.plan.restoreHint')"
      :confirm-label="t(plan.active ? 'hrInsurance.plan.archive' : 'hrInsurance.plan.restore')"
      :cancel-label="t('app.back')"
      :color="plan.active ? 'error' : 'primary'"
      :pending="patch.isPending.value"
      @confirm="toggleArchive"
      @cancel="archiving = false"
    />

    <SharedIdentityCard v-if="plan" :id="plan.id" :name="plan.name" :subtitle="plan.provider.name">
      <template v-if="badge" #badge>
        <SharedStatusBadge size="sm" :tone="badge.tone" :label="t(badge.labelKey)" data-testid="hr-insurance-plan-state" />
      </template>
    </SharedIdentityCard>

    <PlanForm v-if="plan && canManage" :key="plan.revision" :plan="plan" :providers="providers.data.value?.items ?? []" :back-to="backTo" />
    <SharedRecordSection v-else-if="plan" variant="panel" :title="t('hrInsurance.form.planDetails')">
      <dl class="grid gap-x-6 sm:grid-cols-2">
        <SharedPropertyRow :label="t('hrInsurance.form.tier')" :value="plan.tier" />
        <SharedPropertyRow :label="t('hrInsurance.form.policyNumber')" :value="plan.policy_number" />
        <SharedPropertyRow :label="t('hrInsurance.form.validFrom')" :value="plan.valid_from" />
        <SharedPropertyRow :label="t('hrInsurance.form.validTo')" :value="plan.valid_to" />
      </dl>
    </SharedRecordSection>
  </SharedRecordPage>
</template>
