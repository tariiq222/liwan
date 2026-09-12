<script setup lang="ts">
import type { FinanceSummary } from '@nasq/contracts'
import { budgetStatus, financeSummaryMode, formatNullableAmount, formatUtilization } from '@/utils/projectFinance'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = defineProps<{ projectId: number; summary: FinanceSummary; canManage?: boolean }>()
const { t } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const unknown = computed(() => t('projects.finance.unknown'))
const currency = computed(() => props.summary.currency)
const mode = computed(() => financeSummaryMode(props.summary))
const plannedStatus = computed(() => budgetStatus(props.summary))
const charterTo = computed(() => ({ path: `/projects/${props.projectId}/charter`, query: returnToQuery(route.fullPath) }))
const budgetTo = computed(() => ({ path: `/projects/${props.projectId}/finance/new`, query: { kind: 'budget', ...returnToQuery(route.fullPath) } }))
const showCharter = computed(() => mode.value === 'dashboard' || (mode.value === 'empty' && props.summary.charter_estimate != null))
const show = computed(() => mode.value !== 'empty' || props.summary.charter_estimate != null)
</script>

<template>
  <div v-if="show" data-testid="project-finance-summary" class="grid gap-3">
    <section v-if="mode === 'need-budget'" class="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div class="space-y-1">
        <p class="text-muted">{{ t('projects.finance.actual') }}</p>
        <p class="text-2xl font-medium tracking-tight text-highlighted tabular-nums" dir="ltr">{{ formatNullableAmount(summary.actual, currency, unknown) }}</p>
        <p class="text-xs text-muted">{{ t('projects.finance.budgetUnknown') }} · {{ t('projects.finance.expenseCount', { count: summary.expense_count }) }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UButton v-if="canManage" icon="i-lucide-plus" :disabled="!hydrated" :to="budgetTo">{{ t('projects.finance.newBudget') }}</UButton>
        <UButton color="neutral" variant="outline" :to="charterTo" :label="t('projects.refresh.finance.viewCharter')" />
      </div>
    </section>

    <section v-else-if="mode === 'dashboard'" class="grid gap-3 sm:grid-cols-3">
      <UCard :ui="{ body: 'flex items-center gap-4 p-5' }">
        <span class="nasq-ui-metric-icon" aria-hidden="true"><UIcon name="i-lucide-wallet" class="size-5" /></span>
        <div class="min-w-0">
          <p class="truncate text-sm text-muted">{{ t('projects.finance.planned') }}</p>
          <p class="mt-0.5 text-2xl font-semibold tracking-tight text-highlighted tabular-nums" dir="ltr">{{ formatNullableAmount(summary.planned, currency, unknown) }}</p>
          <p class="mt-1 text-xs text-muted">{{ t('projects.finance.budgetCount', { count: summary.budget_count }) }}</p>
        </div>
      </UCard>
      <UCard :ui="{ body: 'flex items-center gap-4 p-5' }">
        <span class="nasq-ui-metric-icon" aria-hidden="true"><UIcon name="i-lucide-receipt" class="size-5" /></span>
        <div class="min-w-0">
          <p class="truncate text-sm text-muted">{{ t('projects.finance.actual') }}</p>
          <p class="mt-0.5 text-2xl font-semibold tracking-tight text-highlighted tabular-nums" dir="ltr">{{ formatNullableAmount(summary.actual, currency, unknown) }}</p>
          <p class="mt-1 text-xs text-muted">{{ t('projects.finance.expenseCount', { count: summary.expense_count }) }}</p>
        </div>
      </UCard>
      <UCard :ui="{ body: 'flex items-center gap-4 p-5' }">
        <span class="nasq-ui-metric-icon" aria-hidden="true"><UIcon name="i-lucide-scale" class="size-5" /></span>
        <div class="min-w-0">
          <p class="truncate text-sm text-muted">{{ t('projects.finance.remaining') }}</p>
          <p class="mt-0.5 text-2xl font-semibold tracking-tight text-highlighted tabular-nums" dir="ltr">{{ formatNullableAmount(summary.remaining, currency, unknown) }}</p>
          <p class="mt-1 text-xs text-muted">
            {{ t('projects.finance.utilization') }}:
            <span dir="ltr">{{ formatUtilization(summary.utilization_percent, unknown) }}</span>
            <UBadge v-if="plannedStatus === 'over'" color="error" variant="subtle" class="ms-2 align-middle">{{ t('projects.finance.overBudget') }}</UBadge>
          </p>
        </div>
      </UCard>
    </section>

    <div v-if="showCharter" data-testid="project-finance-charter" class="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div class="space-y-1">
        <p class="text-muted">{{ t('projects.finance.charterEstimate') }}</p>
        <p v-if="summary.charter_estimate != null" class="font-medium tabular-nums text-highlighted" dir="ltr">{{ formatNullableAmount(summary.charter_estimate, currency, unknown) }}</p>
        <p class="text-xs text-muted">{{ t('projects.finance.charterHint') }}</p>
      </div>
      <UButton color="neutral" variant="outline" :to="charterTo" :label="t('projects.refresh.finance.viewCharter')" />
    </div>
  </div>
</template>
