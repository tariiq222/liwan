<script setup lang="ts">
import type { FinanceAnalyticPlan } from '@liwan/contracts'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { useFinanceAnalyticPlans } from '@/composables/finance/useFinanceAnalytic'
import { canWritePlan, mustChooseParent } from './analyticAccess'
import AnalyticPlanEditor from './AnalyticPlanEditor.vue'

// The plans of the cost centers: a plan is shared by every company. A new plan or a rename opens the editor above the list;
// a plan row offers a rename only when the server would accept it (analyticAccess).
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const query = useFinanceAnalyticPlans()
const plans = computed(() => query.data.value?.items ?? [])
const names = computed(() => new Map(plans.value.map(plan => [plan.id, plan.name])))
const editing = ref<'new' | FinanceAnalyticPlan | null>(null)
const canCreate = computed(() => can('finance.analytic.manage') && (!mustChooseParent(can) || plans.value.length > 0))

const parentLabel = (plan: FinanceAnalyticPlan) => plan.parent ? t('financeAnalytic.plans.under', { name: names.value.get(plan.parent.id) ?? plan.parent.name }) : t('financeAnalytic.plans.root')
const planActions = (plan: FinanceAnalyticPlan): RowAction[] => canWritePlan(can, !plan.parent)
  ? [{ label: t('financeAnalytic.plans.rename'), icon: 'i-lucide-pencil', onSelect: () => { editing.value = plan } }]
  : []
</script>

<template>
  <SharedRecordSection variant="list" :title="t('financeAnalytic.plans.title')" :description="t('financeAnalytic.plans.description')" data-testid="finance-analytic-plans">
    <template v-if="canCreate" #actions>
      <UButton color="primary" icon="i-lucide-plus" :disabled="!hydrated || editing !== null" :label="t('financeAnalytic.plans.new')" data-testid="finance-analytic-plan-new" @click="editing = 'new'" />
    </template>
    <div v-if="editing" class="p-(--liwan-card-pad-dense)">
      <AnalyticPlanEditor :key="editing === 'new' ? 'new' : editing.id" :plan="editing === 'new' ? undefined : editing" :plans="plans" @done="editing = null" @cancel="editing = null" />
    </div>
    <SharedPageState :loading="query.isPending.value" :error="query.error.value" @retry="query.refetch">
      <SharedEmptyState v-if="plans.length === 0" class="m-(--liwan-card-pad-dense)" :title="t('financeAnalytic.plans.empty')" />
      <div v-for="plan in plans" :key="plan.id" class="flex min-w-0 items-center justify-between gap-3 p-(--liwan-card-pad-dense)" :data-testid="`finance-analytic-plan-${plan.id}`">
        <div class="flex min-w-0 flex-col">
          <span class="truncate font-semibold text-highlighted">{{ plan.name }}</span>
          <span class="truncate text-sm text-muted">{{ parentLabel(plan) }}</span>
        </div>
        <SharedRowActions v-if="planActions(plan).length" :actions="planActions(plan)" :label="t('financeAnalytic.plans.actionsNamed', { name: plan.name })" :disabled="!hydrated || editing !== null" />
      </div>
    </SharedPageState>
  </SharedRecordSection>
</template>
