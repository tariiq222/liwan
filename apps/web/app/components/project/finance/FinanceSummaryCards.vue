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
  <section data-testid="project-finance-summary" class="nasq-metrics">
    <article data-testid="project-finance-charter" class="nasq-metric">
      <p class="nasq-metric-title">{{ t('projects.finance.charterEstimate') }}</p>
      <p class="nasq-metric-value tabular-nums" dir="ltr">{{ formatNullableAmount(summary.charter_estimate, currency, unknown) }}</p>
      <p class="nasq-metric-foot">{{ t('projects.finance.charterHint') }}</p>
    </article>
    <article class="nasq-metric">
      <p class="nasq-metric-title">{{ t('projects.finance.planned') }}</p>
      <p class="nasq-metric-value tabular-nums" dir="ltr">{{ formatNullableAmount(summary.planned, currency, unknown) }}</p>
      <p class="nasq-metric-foot">
        <span v-if="plannedStatus === 'unknown'">{{ t('projects.finance.budgetUnknown') }}</span>
        <span v-else>{{ t('projects.finance.budgetCount', { count: summary.budget_count }) }}</span>
      </p>
    </article>
    <article class="nasq-metric">
      <p class="nasq-metric-title">{{ t('projects.finance.actual') }}</p>
      <p class="nasq-metric-value tabular-nums" dir="ltr">{{ formatNullableAmount(summary.actual, currency, unknown) }}</p>
      <p class="nasq-metric-foot">{{ t('projects.finance.expenseCount', { count: summary.expense_count }) }}</p>
    </article>
    <article class="nasq-metric">
      <p class="nasq-metric-title">{{ t('projects.finance.remaining') }}</p>
      <p class="nasq-metric-value tabular-nums" dir="ltr">{{ formatNullableAmount(summary.remaining, currency, unknown) }}</p>
      <p class="nasq-metric-foot">
        {{ t('projects.finance.utilization') }}:
        <span dir="ltr">{{ formatUtilization(summary.utilization_percent, unknown) }}</span>
        <Badge v-if="plannedStatus === 'unknown'" variant="outline" class="ms-2 align-middle">{{ t('projects.finance.budgetUnknown') }}</Badge>
        <Badge v-else-if="plannedStatus === 'over'" variant="destructive" class="ms-2 align-middle">{{ t('projects.finance.overBudget') }}</Badge>
      </p>
    </article>
  </section>
</template>
