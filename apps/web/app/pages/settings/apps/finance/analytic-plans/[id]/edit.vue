<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import AnalyticPlanEditor from '@/components/finance/analytic/AnalyticPlanEditor.vue'
import { canWritePlan } from '@/components/finance/analytic/analyticAccess'
import { useFinanceAnalyticPlan, useFinanceAnalyticPlans } from '@/composables/finance/useFinanceAnalytic'

const DEFAULT_BACK_TO = '/settings/apps/finance?tab=accounting#analytic'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('finance.analytic.manage'))
const id = computed(() => {
  const raw = typeof route.params.id === 'string' ? route.params.id : ''
  if (!/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
})
const backTo = computed(() => safeReturnTo(route.query.returnTo, DEFAULT_BACK_TO, ['/settings/apps/finance']))
const planQuery = useFinanceAnalyticPlan(id, canManage)
const plansQuery = useFinanceAnalyticPlans(() => canManage.value && id.value !== null)
const plan = computed(() => planQuery.data.value ?? null)
const planList = computed(() => plansQuery.data.value?.items ?? [])
const loading = computed(() => id.value !== null && (planQuery.isPending.value || plansQuery.isPending.value))
const error = computed(() => id.value === null ? { status: 404 } : (planQuery.error.value ?? plansQuery.error.value))
function retry() {
  if (!hydrated.value) return
  if (planQuery.error.value) void planQuery.refetch()
  if (plansQuery.error.value) void plansQuery.refetch()
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('financeAnalytic.plans.editTitle')" :back-to="backTo" :back-label="t('financeAnalytic.plans.title')" />
    <SharedForbiddenState v-if="!canManage" :description="t('financeAnalytic.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="error" @retry="retry">
      <SharedForbiddenState v-if="plan && !canWritePlan(can, !plan.parent)" :description="t('financeAnalytic.forbidden')" />
      <SharedFormSection v-else-if="plan" panel>
        <AnalyticPlanEditor :key="plan.id" :plan="plan" :plans="planList" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
