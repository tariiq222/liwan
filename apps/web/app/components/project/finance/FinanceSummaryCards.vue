<script setup lang="ts">
import type { FinanceSummary } from '@nasq/contracts'
import { budgetStatus, formatNullableAmount, formatUtilization } from '@/utils/projectFinance'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = defineProps<{ projectId: number; summary: FinanceSummary }>()
const { t } = useI18n()
const route = useRoute()
const unknown = computed(() => t('projects.finance.unknown'))
const currency = computed(() => props.summary.currency)
const plannedStatus = computed(() => budgetStatus(props.summary))
</script>

<template>
  <section data-testid="project-finance-summary" class="grid gap-3 sm:grid-cols-3">
    <UCard>
      <p class="text-sm text-muted">{{ t('projects.finance.planned') }}</p>
      <p class="mt-1.5 text-2xl font-medium tracking-tight text-highlighted tabular-nums" dir="ltr">{{ formatNullableAmount(summary.planned, currency, unknown) }}</p>
      <p class="mt-1 text-xs text-muted">
        <span v-if="plannedStatus === 'unknown'">{{ t('projects.finance.budgetUnknown') }}</span>
        <span v-else>{{ t('projects.finance.budgetCount', { count: summary.budget_count }) }}</span>
      </p>
    </UCard>
    <UCard>
      <p class="text-sm text-muted">{{ t('projects.finance.actual') }}</p>
      <p class="mt-1.5 text-2xl font-medium tracking-tight text-highlighted tabular-nums" dir="ltr">{{ formatNullableAmount(summary.actual, currency, unknown) }}</p>
      <p class="mt-1 text-xs text-muted">{{ t('projects.finance.expenseCount', { count: summary.expense_count }) }}</p>
    </UCard>
    <UCard>
      <p class="text-sm text-muted">{{ t('projects.finance.remaining') }}</p>
      <p class="mt-1.5 text-2xl font-medium tracking-tight text-highlighted tabular-nums" dir="ltr">{{ formatNullableAmount(summary.remaining, currency, unknown) }}</p>
      <p class="mt-1 text-xs text-muted">
        {{ t('projects.finance.utilization') }}:
        <span dir="ltr">{{ formatUtilization(summary.utilization_percent, unknown) }}</span>
        <UBadge v-if="plannedStatus === 'unknown'" color="neutral" variant="outline" class="ms-2 align-middle">{{ t('projects.finance.budgetUnknown') }}</UBadge>
        <UBadge v-else-if="plannedStatus === 'over'" color="error" variant="subtle" class="ms-2 align-middle">{{ t('projects.finance.overBudget') }}</UBadge>
      </p>
    </UCard>
  </section>
  <UCard data-testid="project-finance-charter" class="mt-3">
    <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div class="space-y-1">
        <p class="text-sm text-muted">{{ t('projects.finance.charterEstimate') }}</p>
        <p class="font-medium tabular-nums text-highlighted" dir="ltr">{{ formatNullableAmount(summary.charter_estimate, currency, unknown) }}</p>
        <p class="text-xs text-muted">{{ t('projects.finance.charterHint') }}</p>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        :to="{ path: `/projects/${props.projectId}/charter`, query: returnToQuery(route.fullPath) }"
        :label="t('projects.refresh.finance.viewCharter')"
      />
    </div>
  </UCard>
</template>
