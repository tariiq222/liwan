<script setup lang="ts">
import type { FinanceSummary } from '@nasq/contracts'
import { budgetStatus, formatNullableAmount, formatUtilization } from '@/utils/projectFinance'

const props = defineProps<{ summary: FinanceSummary }>()
const { t } = useI18n()
const unknown = computed(() => t('projects.finance.unknown'))
const currency = computed(() => props.summary.currency)
const plannedStatus = computed(() => budgetStatus(props.summary))
</script>

<template>
  <section data-testid="project-finance-summary" class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
    <div data-testid="project-finance-charter" class="rounded-lg border bg-card p-4">
      <p class="text-xs text-muted-foreground">{{ t('projects.finance.charterEstimate') }}</p>
      <p class="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">{{ formatNullableAmount(summary.charter_estimate, currency, unknown) }}</p>
      <p class="mt-1 text-[11px] text-muted-foreground">{{ t('projects.finance.charterHint') }}</p>
    </div>
    <div class="rounded-lg border bg-card p-4">
      <p class="text-xs text-muted-foreground">{{ t('projects.finance.planned') }}</p>
      <p class="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">{{ formatNullableAmount(summary.planned, currency, unknown) }}</p>
      <p class="mt-1 text-[11px] text-muted-foreground">
        <span v-if="plannedStatus === 'unknown'">{{ t('projects.finance.budgetUnknown') }}</span>
        <span v-else>{{ t('projects.finance.budgetCount', { count: summary.budget_count }) }}</span>
      </p>
    </div>
    <div class="rounded-lg border bg-card p-4">
      <p class="text-xs text-muted-foreground">{{ t('projects.finance.actual') }}</p>
      <p class="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">{{ formatNullableAmount(summary.actual, currency, unknown) }}</p>
      <p class="mt-1 text-[11px] text-muted-foreground">{{ t('projects.finance.expenseCount', { count: summary.expense_count }) }}</p>
    </div>
    <div class="rounded-lg border bg-card p-4">
      <p class="text-xs text-muted-foreground">{{ t('projects.finance.remaining') }}</p>
      <p class="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">{{ formatNullableAmount(summary.remaining, currency, unknown) }}</p>
      <p class="mt-1 text-[11px] text-muted-foreground">
        {{ t('projects.finance.utilization') }}:
        <span dir="ltr">{{ formatUtilization(summary.utilization_percent, unknown) }}</span>
        <Badge v-if="plannedStatus === 'unknown'" variant="outline" class="ms-2 align-middle">{{ t('projects.finance.budgetUnknown') }}</Badge>
        <Badge v-else-if="plannedStatus === 'over'" variant="destructive" class="ms-2 align-middle">{{ t('projects.finance.overBudget') }}</Badge>
      </p>
    </div>
  </section>
</template>
