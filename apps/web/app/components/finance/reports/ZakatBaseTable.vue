<script setup lang="ts">
import type { FinanceZakatBase } from '@liwan/contracts'
import MisLinesTable from './MisLinesTable.vue'
import ZakatAdjustments from './ZakatAdjustments.vue'
import ZakatReview from './ZakatReview.vue'
import { ZAKAT_RESULT_CODES } from './reportRows'

// The Zakat base lines, then the base and the Zakat due (which include the company's adjustments), the adjustments and the review. The disclaimer (the formula is simplified and must be
// reviewed by a Saudi CPA) is always shown above the table in the user's language, never hidden behind a setting.
const props = defineProps<{ report: FinanceZakatBase }>()
const { t, n } = useI18n()
const totals = computed(() => [
  { label: t('financeReports.zakat.base'), amount: props.report.base },
  { label: t('financeReports.zakat.due'), amount: props.report.zakat_due },
])
</script>

<template>
  <div class="min-w-0">
    <UAlert color="warning" variant="subtle" icon="i-lucide-triangle-alert" class="m-(--liwan-card-pad-dense) w-auto" :title="t('financeReports.zakat.disclaimerLead')" :description="t('financeReports.zakat.disclaimerBody')" data-testid="finance-zakat-disclaimer" />
    <MisLinesTable kind="zakatBase" :lines="report.lines" :currency="report.currency" :hidden="ZAKAT_RESULT_CODES" :totals="totals" :caption="t('financeReports.reports.zakatBase.title')">
      <span class="flex items-center gap-2">
        <span class="text-muted">{{ t('financeReports.zakat.rate') }}</span>
        <bdi class="font-semibold tabular-nums text-highlighted">{{ n(report.rate, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</bdi>
      </span>
    </MisLinesTable>
    <ZakatAdjustments :adjustments="report.adjustments" :date-to="report.date_to" :currency="report.currency" />
    <ZakatReview :report="report" />
  </div>
</template>
