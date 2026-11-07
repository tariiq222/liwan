<script setup lang="ts">
import { useFinanceInvoiceSummary } from '@/composables/finance/useFinanceKpis'
import type { FinanceMoveType } from './invoiceKinds'
import { invoiceSummaryParams, invoiceKpiTiles, type InvoiceKpiCounts, type InvoiceListFilters } from './invoiceListParams'

const props = defineProps<{ moveType: FinanceMoveType; filters: InvoiceListFilters }>()
const { t } = useI18n()
const summary = useFinanceInvoiceSummary(() => invoiceSummaryParams(props.moveType, props.filters))
const counts = computed<InvoiceKpiCounts>(() => ({
  total: summary.data.value?.total,
  draft: summary.data.value?.draft,
  posted: summary.data.value?.posted,
  cancel: summary.data.value?.cancel,
}))
const tiles = computed(() => invoiceKpiTiles(counts.value, id => t(`financeDocuments.kpi.${id}`)))
const loading = computed(() => summary.data.value === undefined)
</script>

<template>
  <SharedKpiStrip :tiles="tiles" :loading="loading" :label="t('financeDocuments.kpi.label')" data-testid="finance-invoice-kpis" />
</template>
