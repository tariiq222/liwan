<script setup lang="ts">
import type { SalesOrderInvoicing } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { formatCurrency } from '@/utils/formatCurrency'
import { INVOICE_STATE_TONE, INVOICING_STATUS_TONE, salesInvoicePath } from '@/utils/salesInvoicing'

// The invoices of an order on its record page (the bridge to Finance): where the order stands, what is invoiced, drafted,
// still to invoice and paid, and the invoices themselves, each linking to its page in finance and coming back to the order.
// The server sends it only to a caller who reads finance invoices, so a caller who cannot never gets a number; the page
// shows the section exactly when the field is there. `online` explains why an online order offers no invoice here.
const props = defineProps<{ invoicing: SalesOrderInvoicing; currency: string; orderId: number; online?: boolean }>()
const { t, locale } = useI18n()
const money = (amount: number, currency = props.currency) => formatCurrency(amount, currency, locale.value)
// A figure that is zero says nothing more than its absence, except the three that always show.
const figures = computed(() => [
  { key: 'invoiced', value: props.invoicing.amount_invoiced, always: true },
  { key: 'drafted', value: props.invoicing.amount_drafted, always: false },
  { key: 'credited', value: props.invoicing.amount_credited, always: false },
  { key: 'toInvoice', value: props.invoicing.amount_to_invoice, always: true },
  { key: 'paid', value: props.invoicing.amount_paid, always: true },
].filter(figure => figure.always || figure.value > 0))
const invoiceTo = (invoice: SalesOrderInvoicing['invoices'][number]) => ({ path: salesInvoicePath(invoice.kind, invoice.id), query: { returnTo: `/sales/${props.orderId}` } })
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('sales.invoicing.title')" data-testid="sales-invoicing">
    <div class="grid gap-4">
      <p v-if="online" class="text-sm text-muted" data-testid="sales-invoicing-online">{{ t('sales.invoicing.online') }}</p>
      <div class="flex flex-wrap items-center gap-3">
        <SharedStatusBadge :tone="INVOICING_STATUS_TONE[invoicing.status]" :label="t(`sales.invoicing.status.${invoicing.status}`)" size="sm" data-testid="sales-invoicing-status" />
      </div>
      <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-3" data-testid="sales-invoicing-figures">
        <div v-for="figure in figures" :key="figure.key" class="grid gap-0.5">
          <dt class="text-sm text-muted">{{ t(`sales.invoicing.amounts.${figure.key}`) }}</dt>
          <dd class="font-semibold text-highlighted" :data-testid="`sales-invoicing-${figure.key}`"><bdi dir="ltr">{{ money(figure.value) }}</bdi></dd>
        </div>
      </dl>
      <p v-if="!invoicing.invoices.length" class="text-sm text-muted" data-testid="sales-invoicing-empty">{{ t('sales.invoicing.empty') }}</p>
      <ul v-else class="divide-y divide-default" data-testid="sales-invoice-list">
        <li v-for="invoice in invoicing.invoices" :key="invoice.id" class="grid gap-1 py-3 first:pt-0 last:pb-0" :data-testid="`sales-invoice-${invoice.id}`">
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <NuxtLink :to="invoiceTo(invoice)" class="min-w-0 truncate font-semibold text-primary hover:underline" data-testid="sales-invoice-link"><bdi>{{ invoice.number ?? t('sales.invoicing.draftNumber') }}</bdi></NuxtLink>
            <SharedStatusBadge tone="neutral" :label="t(`sales.invoicing.kinds.${invoice.kind}`)" size="sm" />
            <SharedStatusBadge :tone="INVOICE_STATE_TONE[invoice.state]" :label="t(`sales.invoicing.states.${invoice.state}`)" size="sm" data-testid="sales-invoice-state" />
            <SharedStatusBadge v-if="invoice.state === 'posted'" tone="info" :label="t(`sales.invoicing.paymentStates.${invoice.payment_state}`)" size="sm" />
          </div>
          <p class="flex flex-wrap gap-x-3 text-sm text-muted">
            <bdi dir="ltr" data-testid="sales-invoice-total">{{ money(invoice.amount_total, invoice.currency) }}</bdi>
            <bdi v-if="invoice.invoice_date_due" dir="ltr">{{ formatDate(invoice.invoice_date_due) }}</bdi>
          </p>
        </li>
      </ul>
    </div>
  </SharedRecordSection>
</template>
