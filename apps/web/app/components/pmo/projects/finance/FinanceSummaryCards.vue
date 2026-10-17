<script setup lang="ts">
import type { FinanceSummary } from '@webvue/contracts'
import { budgetStatus, financeSummaryMode, formatNullableAmount, formatUtilization } from '@/utils/projectFinance'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

const props = defineProps<{ projectId: number; summary: FinanceSummary; canManage?: boolean }>()
const { t } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const unknown = computed(() => t('projects.finance.unknown'))
const currency = computed(() => props.summary.currency)
const mode = computed(() => financeSummaryMode(props.summary))
const plannedStatus = computed(() => budgetStatus(props.summary))
// The remaining budget is the variance: below zero is a loss (danger), above it room left (success).
const remainingTone = computed<'neutral' | 'danger' | 'success'>(() => {
  const remaining = props.summary.remaining
  if (remaining == null || remaining === 0) return 'neutral'
  return remaining < 0 ? 'danger' : 'success'
})
const charterTo = computed(() => ({ path: `/projects/${props.projectId}/charter`, query: returnToQuery(route.fullPath) }))
const budgetTo = computed(() => ({ path: `/projects/${props.projectId}/finance/new`, query: { kind: 'budget', ...returnToQuery(route.fullPath) } }))
const showCharter = computed(() => props.summary.charter_estimate != null)
const show = computed(() => mode.value !== 'empty' || props.summary.charter_estimate != null)
</script>

<template>
  <div v-if="show" data-testid="project-finance-summary" class="grid gap-(--webvue-gap-card)">
    <SharedRecordSection v-if="mode === 'need-budget'" variant="panel" :title="t('projects.finance.actual')">
      <template #actions>
        <UButton v-if="canManage" icon="i-lucide-plus" :disabled="!hydrated" :to="budgetTo">{{ t('projects.finance.newBudget') }}</UButton>
        <UButton color="neutral" variant="outline" :to="charterTo" :label="t('projects.refresh.finance.viewCharter')" />
      </template>
      <div class="space-y-1">
        <p class="text-2xl font-semibold tracking-tight text-highlighted tabular-nums"><bdi dir="ltr">{{ formatNullableAmount(summary.actual, currency, unknown) }}</bdi></p>
        <p class="text-xs text-muted">{{ t('projects.finance.budgetUnknown') }} · {{ t('projects.finance.expenseCount', { count: summary.expense_count }, summary.expense_count) }}</p>
      </div>
    </SharedRecordSection>

    <section v-else-if="mode === 'dashboard'" class="grid gap-(--webvue-gap-card) sm:grid-cols-3">
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
        :hint="t('projects.finance.expenseCount', { count: summary.expense_count }, summary.expense_count)"
      >
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
