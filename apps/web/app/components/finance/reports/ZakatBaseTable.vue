<script setup lang="ts">
import type { FinanceZakatBase } from '@webvue/contracts'
import MisLinesTable from './MisLinesTable.vue'
import { ZAKAT_RESULT_CODES } from './reportRows'

// The Zakat base lines, then the base and the Zakat due. The server's disclaimer (the formula is simplified and must be
// reviewed by a Saudi CPA) is always shown above the table, never hidden behind a setting.
const props = defineProps<{ report: FinanceZakatBase }>()
const { t, n } = useI18n()
const totals = computed(() => [
  { label: t('financeReports.zakat.base'), amount: props.report.base },
  { label: t('financeReports.zakat.due'), amount: props.report.zakat_due },
])
</script>

<template>
  <div class="min-w-0">
    <UAlert color="warning" variant="subtle" icon="i-lucide-triangle-alert" class="m-(--webvue-card-pad-dense) w-auto" :title="t('financeReports.zakat.disclaimerLead')" :description="report.disclaimer" data-testid="finance-zakat-disclaimer" />
    <MisLinesTable kind="zakatBase" :lines="report.lines" :currency="report.currency" :hidden="ZAKAT_RESULT_CODES" :totals="totals" :caption="t('financeReports.reports.zakatBase.title')">
      <span class="flex items-center gap-2">
        <span class="text-muted">{{ t('financeReports.zakat.rate') }}</span>
        <bdi class="font-semibold tabular-nums text-highlighted">{{ n(report.rate, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</bdi>
      </span>
    </MisLinesTable>
  </div>
</template>
