<script setup lang="ts">
import type { FinanceSummary } from '@liwan/contracts'
import FinanceActualAccountPicker from '@/components/pmo/projects/finance/FinanceActualAccountPicker.vue'
import FinanceActualSource from '@/components/pmo/projects/finance/FinanceActualSource.vue'
import { budgetStatus, financeSummaryMode, formatNullableAmount, formatUtilization, isExternalActual } from '@/utils/projectFinance'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'

const props = defineProps<{ projectId: number; summary: FinanceSummary }>()
const { t } = useI18n()
const route = useRoute()
const unknown = computed(() => t('projects.finance.unknown'))
const currency = computed(() => props.summary.currency)
const mode = computed(() => financeSummaryMode(props.summary))
const external = computed(() => isExternalActual(props.summary))
const actualCount = computed(() => external.value
  ? t('projects.finance.actualLineCount', { count: props.summary.expense_count }, props.summary.expense_count)
  : t('projects.finance.expenseCount', { count: props.summary.expense_count }, props.summary.expense_count))
const plannedStatus = computed(() => budgetStatus(props.summary))
// The remaining budget is the variance: below zero is a loss (danger), above it room left (success).
const remainingTone = computed<'neutral' | 'danger' | 'success'>(() => {
  const remaining = props.summary.remaining
  if (remaining == null || remaining === 0) return 'neutral'
  return remaining < 0 ? 'danger' : 'success'
})
const charterTo = computed(() => ({ path: `/projects/${props.projectId}/charter`, query: returnToQuery(route.fullPath) }))
const showCharter = computed(() => props.summary.charter_estimate != null)
const show = computed(() => mode.value !== 'empty' || props.summary.charter_estimate != null)
</script>

<template>
  <div v-if="show" data-testid="project-finance-summary" class="grid gap-(--liwan-gap-card)">
    <SharedRecordSection v-if="mode === 'need-budget'" variant="panel" :title="t('projects.finance.actual')">
      <template #actions>
        <UButton color="neutral" variant="outline" :to="charterTo" :label="t('projects.refresh.finance.viewCharter')" />
      </template>
      <div class="space-y-1">
        <p class="text-2xl font-semibold tracking-tight text-highlighted tabular-nums"><bdi dir="ltr">{{ formatNullableAmount(summary.actual, currency, unknown) }}</bdi></p>
        <p class="text-xs text-muted">{{ t('projects.finance.budgetUnknown') }} · {{ actualCount }}</p>
        <FinanceActualSource v-if="external" :summary="summary" />
      </div>
    </SharedRecordSection>

    <section v-else-if="mode === 'dashboard'" class="grid gap-(--liwan-gap-card) sm:grid-cols-3">
      <SharedMetricTile
        density="compact"
        icon="i-lucide-wallet"
        :label="t('projects.finance.planned')"
        :value="formatNullableAmount(summary.planned, currency, unknown)"
        value-dir="ltr"
        :hint="t('projects.finance.budgetCount', { count: summary.budget_count }, summary.budget_count)"
      />
      <SharedMetricTile
        density="compact"
        icon="i-lucide-receipt"
        :label="t('projects.finance.actual')"
        :value="formatNullableAmount(summary.actual, currency, unknown)"
        value-dir="ltr"
        :hint="actualCount"
      >
        <FinanceActualSource v-if="external" :summary="summary" />
        <template v-if="summary.utilization_percent != null">
          <p class="mt-1 text-xs text-muted">
            {{ t('projects.finance.utilization') }}:
            <span dir="ltr">{{ formatUtilization(summary.utilization_percent, unknown) }}</span>
            <SharedStatusBadge v-if="plannedStatus === 'over'" tone="destructive" size="sm" class="ms-2 align-middle" :label="t('projects.finance.overBudget')" />
          </p>
          <SharedProgress class="mt-1.5" :value="summary.utilization_percent" :tone="plannedStatus === 'over' ? 'danger' : 'primary'" :label="t('projects.finance.utilization')" />
        </template>
      </SharedMetricTile>
      <SharedMetricTile
        density="compact"
        icon="i-lucide-scale"
        :tone="remainingTone"
        :label="t('projects.finance.remaining')"
        :value="formatNullableAmount(summary.remaining, currency, unknown)"
        value-dir="ltr"
      />
    </section>

    <FinanceActualAccountPicker v-if="external && summary.can_choose_actual_account" :project-id="projectId" :summary="summary" />

    <SharedRecordSection v-if="showCharter" variant="tinted" data-testid="project-finance-charter" :title="t('projects.finance.charterEstimate')">
      <template #actions>
        <UButton color="neutral" variant="outline" :to="charterTo" :label="t('projects.refresh.finance.viewCharter')" />
      </template>
      <div class="space-y-1">
        <p class="text-sm font-semibold tabular-nums text-highlighted"><bdi dir="ltr">{{ formatNullableAmount(summary.charter_estimate, currency, unknown) }}</bdi></p>
        <p class="text-xs text-muted">{{ t('projects.finance.charterHint') }}</p>
      </div>
    </SharedRecordSection>
  </div>
</template>
