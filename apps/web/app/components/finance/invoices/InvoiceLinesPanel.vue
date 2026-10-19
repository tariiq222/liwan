<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceInvoiceDetail, FinanceInvoiceLine } from '@webvue/contracts'
import Money from './Money.vue'

// The lines of a document and its totals, read-only. A draft is edited in the InvoiceForm instead.
const props = defineProps<{ invoice: FinanceInvoiceDetail }>()
const { t } = useI18n()
const numeric = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<FinanceInvoiceLine>[]>(() => [
  { id: 'name', header: t('financeDocuments.form.lineName') },
  { id: 'quantity', header: t('financeDocuments.form.quantity'), meta: numeric },
  { id: 'price_unit', header: t('financeDocuments.form.unitPrice'), meta: numeric },
  { id: 'discount', header: t('financeDocuments.form.discount'), meta: numeric },
  { id: 'taxes', header: t('financeDocuments.record.taxes') },
  { id: 'price_subtotal', header: t('financeDocuments.record.lineTotal'), meta: numeric },
])
const totals = computed(() => [
  { id: 'untaxed', label: t('financeDocuments.record.untaxed'), amount: props.invoice.amount_untaxed },
  { id: 'tax', label: t('financeDocuments.record.tax'), amount: props.invoice.amount_tax },
  { id: 'total', label: t('financeDocuments.record.total'), amount: props.invoice.amount_total, strong: true },
  ...(props.invoice.state === 'posted' ? [{ id: 'residual', label: t('financeDocuments.record.residual'), amount: props.invoice.amount_residual, strong: true }] : []),
])
</script>

<template>
  <SharedRecordSection variant="list" :title="t('financeDocuments.form.lines')" data-testid="finance-invoice-lines-panel">
    <SharedDataTable bare :rows="invoice.lines" :columns="columns" row-key="id" :caption="t('financeDocuments.form.lines')">
      <template #name-cell="{ row }">{{ row.original.name }}</template>
      <template #quantity-cell="{ row }"><bdi class="tabular-nums">{{ row.original.quantity }}</bdi></template>
      <template #price_unit-cell="{ row }"><Money :amount="row.original.price_unit" /></template>
      <template #discount-cell="{ row }"><bdi class="tabular-nums">{{ row.original.discount }}%</bdi></template>
      <template #taxes-cell="{ row }">{{ row.original.taxes.map(tax => tax.name).join('، ') || t('app.notAvailable') }}</template>
      <template #price_subtotal-cell="{ row }"><Money :amount="row.original.price_subtotal" :currency="invoice.currency" /></template>
      <template #mobile-row="{ row }">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-semibold text-highlighted">{{ row.name }}</p>
            <p class="text-sm text-muted"><bdi class="tabular-nums">{{ row.quantity }}</bdi> × <Money :amount="row.price_unit" /></p>
          </div>
          <Money :amount="row.price_subtotal" :currency="invoice.currency" />
        </div>
      </template>
    </SharedDataTable>
    <dl class="ms-auto grid w-full max-w-sm gap-2 border-t border-default p-(--webvue-card-pad) text-sm" data-testid="finance-invoice-totals">
      <div v-for="row in totals" :key="row.id" class="flex items-center justify-between gap-4" :class="row.strong ? 'font-semibold text-highlighted' : 'text-muted'">
        <dt>{{ row.label }}</dt>
        <dd><Money :amount="row.amount" :currency="invoice.currency" /></dd>
      </div>
    </dl>
  </SharedRecordSection>
</template>
