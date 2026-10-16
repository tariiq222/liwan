<script setup lang="ts">
import { invoiceStatusBadge } from '@nasq/commercial-ui/app/utils/commercialBadges'
import { paymentAttemptBadge } from '@/utils/vendorBadges'
import { formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'
import { invoicesReturnTo, isCreditRelated, isNotAvailable, isOverdue, vendorInvoiceLineViews } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { formatNasqDate, formatNasqDateTime } from '@nasq/ui/app/composables/calendarDate'
definePageMeta({ capability: 'vendor.billing.manage' })
const { t, locale } = useI18n(); const route = useRoute(); const api = useVendorSubscriptions()
const { can } = useVendorContext()
const canBilling = computed(() => can('vendor.billing.manage'))
const id = computed(() => String(route.params.id))
const backTo = computed(() => invoicesReturnTo(route.query.returnTo))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:invoice:${id.value}`, () => api.invoice(id.value))
const orderId = computed(() => data.value?.order_id)
const { data: attempts, error: attemptsError, pending: attemptsPending, refresh: refreshAttempts } = await useAsyncData(
  () => `vendor:invoice-attempts:${id.value}:${orderId.value ?? 'none'}:${canBilling.value}`,
  () => orderId.value && canBilling.value ? api.paymentAttempts(orderId.value) : Promise.resolve(null),
)
const attemptTime = (value: string) => formatNasqDateTime(value, locale.value)
const unavailable = computed(() => isNotAvailable(error.value) && !data.value)
const money = (m: NonNullable<typeof data.value>['total']) => formatCommercialMoney(m, locale.value)
const date = (v: string | null) => (v ? formatNasqDate(v, locale.value) : null)
const badge = computed(() => (data.value ? invoiceStatusBadge(data.value.status, 'vendor.invoices.status') : null))
const notOfficial = computed(() => `${t('vendor.invoices.notOfficial')} — ${t('vendor.invoices.notOfficialHint')}`)
</script>
<template>
<SharedRecordPage :title="data ? (data.number ?? t('vendor.invoices.draftNumber')) : t('vendor.invoices.details')" :description="data && !unavailable ? notOfficial : undefined" :back-to="backTo" :loading="pending" :error="unavailable ? undefined : error" @retry="refresh">
  <UAlert v-if="unavailable" color="neutral" variant="subtle" icon="i-lucide-clock" :title="t('vendor.invoices.notAvailable')" :description="t('vendor.invoices.notAvailableHint')" />

  <template v-if="data && !unavailable" #summary>
    <div class="space-y-4" data-testid="invoice-header">
      <div class="flex flex-wrap items-center gap-3">
        <SharedStatusBadge v-if="badge" :tone="badge.tone" :label="t(badge.labelKey)" />
        <span class="text-sm text-muted">{{ t(`vendor.invoices.kind.${data.kind}`) }}</span>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <SharedMetricTile :label="t('vendor.invoices.total')" :value="money(data.total)" icon="i-lucide-receipt" value-dir="ltr" />
        <SharedMetricTile :label="t('vendor.invoices.dueAt')" :value="date(data.due_at)" icon="i-lucide-calendar-clock" :hint="isOverdue(data) ? t('vendor.invoices.overdue') : undefined" />
      </div>
    </div>
  </template>

  <div v-if="data && !unavailable" class="space-y-6">
    <SharedRecordSection :title="t('vendor.invoices.lines')"><SharedInvoiceLines :lines="vendorInvoiceLineViews(data.lines, t, locale)" :totals="[{label:t('vendor.invoices.subtotal'),value:money(data.subtotal)},{label:t('vendor.invoices.vat'),value:money(data.tax)},{label:t('vendor.invoices.total'),value:money(data.total)}]" /><p class="text-xs text-muted">{{ t('vendor.invoices.vatNote') }}</p></SharedRecordSection>

    <SharedRecordSection v-if="canBilling" :title="t('vendor.invoices.attempts')">
      <SharedPageState :loading="attemptsPending" :error="attemptsError" @retry="refreshAttempts">
        <SharedEmptyState v-if="!attempts?.items.length" :title="t('vendor.invoices.attemptsNone')" icon="i-lucide-credit-card" />
        <ul v-else class="divide-y divide-default">
          <li v-for="attempt in attempts.items" :key="attempt.id" class="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="payment-attempt">
            <SharedStatusBadge :tone="paymentAttemptBadge(attempt.status).tone" :label="t(paymentAttemptBadge(attempt.status).labelKey)" />
            <span class="tabular-nums">{{ money(attempt.amount) }}</span>
            <time :datetime="attempt.created_at" class="text-sm text-muted">{{ attemptTime(attempt.created_at) }}</time>
          </li>
        </ul>
      </SharedPageState>
    </SharedRecordSection>
    <SharedRecordSection :title="t('vendor.invoices.adjustments')">
      <p class="text-sm" :class="isCreditRelated(data) ? '' : 'text-muted'">{{ isCreditRelated(data) ? t('vendor.invoices.creditPending') : t('vendor.invoices.adjustmentsNone') }}</p>
      <p class="mt-1 text-xs text-muted">{{ t('vendor.invoices.immutable') }}</p>
    </SharedRecordSection>
    <details class="text-sm"><summary class="cursor-pointer text-muted">{{ t('vendor.customers.technical') }}</summary>
      <dl class="mt-3 space-y-2"><div><dt>{{ t('vendor.invoices.techId') }}</dt><dd dir="ltr">{{ data.id }}</dd></div><div v-if="data.order_id"><dt>{{ t('vendor.invoices.techOrder') }}</dt><dd dir="ltr">{{ data.order_id }}</dd></div></dl>
    </details>
  </div>

  <template v-if="data && !unavailable" #aside>
    <SharedPropertiesPanel>
      <SharedPropertyRow :label="t('vendor.invoices.customer')"><NuxtLink :to="{ path: `/customers/${encodeURIComponent(data.customer_id)}` }" class="hover:underline">{{ data.customer_name }}</NuxtLink></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.invoices.period')"><bdi dir="ltr">{{ data.period_start }} → {{ data.period_end }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.invoices.issuedAt')" :value="date(data.issued_at)" />
      <SharedPropertyRow :label="t('vendor.invoices.paidAt')" :value="date(data.paid_at)" />
    </SharedPropertiesPanel>
  </template>
</SharedRecordPage>
</template>
