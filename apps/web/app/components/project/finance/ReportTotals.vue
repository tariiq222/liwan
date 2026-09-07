<script setup lang="ts">
import type { ProjectReportTotals } from '@nasq/contracts'
import { formatMoney, formatTotalsPlanned, formatTotalsRemaining } from '@/utils/projectFinance'

defineProps<{ totals: ProjectReportTotals[] }>()
const { t } = useI18n()
</script>

<template>
  <section data-testid="reports-totals" class="space-y-3">
    <div>
      <h2 class="text-base font-semibold">{{ t('projects.reports.totalsTitle') }}</h2>
      <p class="text-sm text-muted-foreground">{{ t('projects.reports.totalsRemainingHint') }}</p>
    </div>
    <div v-if="!totals.length" class="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      {{ t('projects.reports.totalsEmpty') }}
    </div>
    <div v-else class="grid gap-3 md:grid-cols-2">
      <article v-for="group in totals" :key="group.currency.id" class="rounded-lg border bg-card p-4" data-testid="reports-total-card">
        <p class="text-sm font-medium">{{ group.currency.name }} ({{ group.currency.symbol }})</p>
        <dl class="mt-3 grid gap-2 text-sm">
          <div class="flex justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('projects.reports.projectCount') }}</dt>
            <dd class="tabular-nums">{{ group.project_count }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('projects.reports.budgetedProjectCount') }}</dt>
            <dd class="tabular-nums">{{ group.budgeted_project_count }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('projects.finance.planned') }}</dt>
            <dd class="tabular-nums" dir="ltr">{{ formatTotalsPlanned(group, t('projects.finance.unknown')) }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('projects.finance.actual') }}</dt>
            <dd class="tabular-nums" dir="ltr">{{ formatMoney(group.actual, group.currency) }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('projects.finance.remaining') }}</dt>
            <dd class="tabular-nums" dir="ltr">{{ formatTotalsRemaining(group, t('projects.finance.unknown')) }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted-foreground">{{ t('projects.reports.overBudgetCount') }}</dt>
            <dd class="tabular-nums">{{ group.over_budget_count }}</dd>
          </div>
        </dl>
      </article>
    </div>
  </section>
</template>
