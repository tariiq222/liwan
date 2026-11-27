<script setup lang="ts">
import type { FinanceAnalyticPlan } from '@liwan/contracts'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { useFinanceAnalyticPlans } from '@/composables/finance/useFinanceAnalytic'
import { canWritePlan, mustChooseParent } from './analyticAccess'

// The plans of the cost centers: a plan is shared by every company. Creating opens the route-backed slideover,
// renaming opens the edit page; a plan row offers a rename only when the server would accept it (analyticAccess).
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const query = useFinanceAnalyticPlans()
const plans = computed(() => query.data.value?.items ?? [])
const names = computed(() => new Map(plans.value.map(plan => [plan.id, plan.name])))
const canCreate = computed(() => can('finance.analytic.manage') && (!mustChooseParent(can) || plans.value.length > 0))

const parentLabel = (plan: FinanceAnalyticPlan) => plan.parent ? t('financeAnalytic.plans.under', { name: names.value.get(plan.parent.id) ?? plan.parent.name }) : t('financeAnalytic.plans.root')
const planActions = (plan: FinanceAnalyticPlan): RowAction[] => canWritePlan(can, !plan.parent)
  ? [{
      label: t('financeAnalytic.plans.rename'),
      icon: 'i-lucide-pencil',
      to: { path: `/settings/apps/finance/analytic-plans/${plan.id}/edit`, query: returnToQuery(route.fullPath) },
    }]
  : []
</script>

<template>
  <SharedRecordSection variant="list" :title="t('financeAnalytic.plans.title')" :description="t('financeAnalytic.plans.description')" data-testid="finance-analytic-plans">
    <template v-if="canCreate" #actions>
      <UButton
        :to="{ path: '/settings/apps/finance/analytic-plans/new', query: returnToQuery(route.fullPath) }"
        icon="i-lucide-plus"
        :disabled="!hydrated"
        :label="t('financeAnalytic.plans.new')"
        data-testid="finance-analytic-plan-new"
      />
    </template>
    <SharedPageState :loading="query.isPending.value" :error="query.error.value" @retry="query.refetch">
      <SharedEmptyState v-if="plans.length === 0" icon="i-lucide-chart-pie" class="m-(--liwan-card-pad-dense)" :title="t('financeAnalytic.plans.empty')" />
      <div v-for="plan in plans" :key="plan.id" class="flex min-w-0 items-center justify-between gap-3 p-(--liwan-card-pad-dense)" :data-testid="`finance-analytic-plan-${plan.id}`">
        <div class="flex min-w-0 flex-col">
          <span class="truncate font-semibold text-highlighted">{{ plan.name }}</span>
          <span class="truncate text-sm text-muted">{{ parentLabel(plan) }}</span>
        </div>
        <SharedRowActions v-if="planActions(plan).length" :actions="planActions(plan)" :label="t('financeAnalytic.plans.actionsNamed', { name: plan.name })" :disabled="!hydrated" />
      </div>
    </SharedPageState>
  </SharedRecordSection>
</template>
