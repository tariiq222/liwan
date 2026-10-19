<script setup lang="ts">
import { useFinanceInvoiceList } from '@/composables/finance/useFinanceInvoices'
import type { FinanceMoveType } from './invoiceKinds'
import { invoiceKpiParams, invoiceKpiTiles, type InvoiceKpiCounts, type InvoiceListFilters } from './invoiceListParams'

// The counts above a document list: every figure is the total the server reports for the list's own filters
// (the state filter excepted: each tile picks its state), asked for with one row, never counted from the loaded page.
const props = defineProps<{ moveType: FinanceMoveType; filters: InvoiceListFilters }>()
const { t } = useI18n()
const total = useFinanceInvoiceList(() => invoiceKpiParams(props.moveType, props.filters, null))
const draft = useFinanceInvoiceList(() => invoiceKpiParams(props.moveType, props.filters, 'draft'))
const posted = useFinanceInvoiceList(() => invoiceKpiParams(props.moveType, props.filters, 'posted'))
const cancelled = useFinanceInvoiceList(() => invoiceKpiParams(props.moveType, props.filters, 'cancel'))
const counts = computed<InvoiceKpiCounts>(() => ({
  total: total.data.value?.total,
  draft: draft.data.value?.total,
  posted: posted.data.value?.total,
  cancel: cancelled.data.value?.total,
}))
const tiles = computed(() => invoiceKpiTiles(counts.value, id => t(`financeDocuments.kpi.${id}`)))
const loading = computed(() => Object.values(counts.value).some(count => count === undefined))
</script>

<template>
  <SharedKpiStrip :tiles="tiles" :loading="loading" :label="t('financeDocuments.kpi.label')" data-testid="finance-invoice-kpis" />
</template>
