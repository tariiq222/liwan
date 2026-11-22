<script setup lang="ts">
import type { CustomerInvoice } from '@liwan/commercial-contracts'
import { formatCommercialMoney } from '../../../utils/commercial'
import { invoiceCreditSummary, invoiceDay, invoiceLinesView, invoicePeriod, sellerLegalName } from '../../../utils/invoiceDocument'

// The printable subscription invoice: Liwan's own billing document for the customer's accountant, printed by the customer app and the vendor console alike. Dates are the
// Riyadh day (owner decision 2026-11-22). Liwan is not
// VAT-registered (owner decision 2026-11-06), so an untaxed invoice shows one total and no tax wording at all.
const props = defineProps<{ invoice: CustomerInvoice }>()
const { t, locale } = useI18n()
const money = (value: CustomerInvoice['total']) => formatCommercialMoney(value, locale.value)
const view = computed(() => invoiceLinesView(props.invoice, t, locale.value))
const totals = computed(() => props.invoice.tax_label === null
  ? [{ label: t('commercial.invoice.total'), value: money(props.invoice.total) }]
  : view.value.totals)
const credit = computed(() => invoiceCreditSummary(props.invoice))
const stateLabel = computed(() => credit.value.state === 'refunded' ? t('commercial.invoice.document.refunded') : t(`commercial.invoice.statuses.${credit.value.state}`))
const seller = computed(() => props.invoice.seller)
const sellerName = computed(() => seller.value ? sellerLegalName(seller.value, locale.value) : t('app.productName'))
const sellerLines = computed(() => {
  const s = seller.value
  if (!s) return []
  return [...s.address.split('\n'), [s.city, s.country].filter(Boolean).join(', '), s.commercial_registration ? `${t('commercial.invoice.document.registration')}: ${s.commercial_registration}` : '', s.email, s.phone]
    .map(line => line.trim()).filter(Boolean)
})
const facts = computed(() => [
  { key: 'number', label: t('commercial.invoice.number'), value: props.invoice.number },
  { key: 'issued', label: t('commercial.invoice.document.issuedOn'), value: invoiceDay(props.invoice.issued_at) },
  { key: 'due', label: t('commercial.invoice.document.dueOn'), value: invoiceDay(props.invoice.due_at) },
  { key: 'paid', label: t('commercial.invoice.document.paidOn'), value: invoiceDay(props.invoice.paid_at) },
  { key: 'period', label: t('commercial.invoice.period'), value: invoicePeriod(props.invoice) },
].filter(fact => fact.value))
const notes = computed(() => props.invoice.credit_notes.map(note => ({
  ...note,
  causeLabel: t(`commercial.invoice.document.causes.${note.cause}`),
  statusLabel: t(`commercial.invoice.document.noteStatuses.${note.status}`),
  date: invoiceDay(note.refunded_at ?? note.created_at),
  amountLabel: money(note.amount),
})))
</script>

<template>
  <div class="grid min-w-0 gap-6" data-testid="invoice-document">
    <header class="flex min-w-0 items-start justify-between gap-4 border-b-2 border-primary pb-3">
      <div class="grid gap-0.5">
        <p class="text-xl font-bold" data-testid="invoice-seller-name">{{ sellerName }}</p>
        <p v-for="line in sellerLines" :key="line" class="text-sm text-muted" data-testid="invoice-seller-line"><bdi>{{ line }}</bdi></p>
      </div>
      <div class="grid justify-items-end gap-0.5 text-end">
        <h2 class="text-base text-muted">{{ t('commercial.invoice.document.title') }}</h2>
        <p class="font-semibold" data-testid="invoice-state">{{ stateLabel }}</p>
      </div>
    </header>
    <section class="grid gap-1" :aria-label="t('commercial.invoice.document.customer')">
      <p class="text-xs text-muted">{{ t('commercial.invoice.document.customer') }}</p>
      <p class="font-semibold" data-testid="invoice-customer">{{ props.invoice.customer_name }}</p>
    </section>
    <dl class="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
      <div v-for="fact in facts" :key="fact.key" class="grid gap-0.5 rounded-control border border-default px-2.5 py-2">
        <dt class="text-xs text-muted">{{ fact.label }}</dt>
        <dd class="font-semibold"><bdi dir="ltr">{{ fact.value }}</bdi></dd>
      </div>
    </dl>
    <SharedInvoiceLines layout="table" :lines="view.lines" :totals="totals" />
    <section v-if="notes.length" class="grid gap-2" data-testid="invoice-credit-notes">
      <h3 class="font-semibold">{{ t('commercial.invoice.document.creditNotes') }}</h3>
      <table class="w-full text-sm">
        <caption class="sr-only">{{ t('commercial.invoice.document.creditNotes') }}</caption>
        <thead class="text-muted">
          <tr>
            <th scope="col" class="py-1 pe-3 text-start font-medium">{{ t('commercial.invoice.document.noteDate') }}</th>
            <th scope="col" class="px-3 py-1 text-start font-medium">{{ t('commercial.invoice.document.noteCause') }}</th>
            <th scope="col" class="px-3 py-1 text-start font-medium">{{ t('commercial.invoice.document.noteReference') }}</th>
            <th scope="col" class="px-3 py-1 text-start font-medium">{{ t('commercial.invoice.status') }}</th>
            <th scope="col" class="ps-3 py-1 text-start font-medium">{{ t('commercial.invoice.document.noteAmount') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-for="note in notes" :key="note.id" data-testid="invoice-credit-note">
            <td class="py-1 pe-3"><bdi dir="ltr">{{ note.date }}</bdi></td>
            <td class="px-3 py-1">{{ note.causeLabel }}</td>
            <td class="px-3 py-1"><bdi v-if="note.refund_reference" dir="ltr">{{ note.refund_reference }}</bdi><template v-else>—</template></td>
            <td class="px-3 py-1">{{ note.statusLabel }}</td>
            <td class="ps-3 py-1 font-medium tabular-nums"><bdi dir="ltr">−{{ note.amountLabel }}</bdi></td>
          </tr>
        </tbody>
      </table>
      <p class="flex items-baseline justify-between gap-4 border-t border-default pt-2 font-semibold" data-testid="invoice-net">
        <span>{{ t('commercial.invoice.document.net') }}</span>
        <bdi dir="ltr" class="tabular-nums">{{ money(credit.net) }}</bdi>
      </p>
    </section>
  </div>
</template>
