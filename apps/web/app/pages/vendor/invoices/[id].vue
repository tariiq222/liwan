<script setup lang="ts">
import { formatVendorMoney } from '@/utils/vendorCommercial'
import { invoiceStatusColor, invoicesReturnTo, isCreditRelated, isNotAvailable } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t, locale } = useI18n(); const route = useRoute(); const api = useVendorSubscriptions()
const id = computed(() => String(route.params.id))
const backTo = computed(() => invoicesReturnTo(route.query.returnTo))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:invoice:${id.value}`, () => api.invoice(id.value))
const unavailable = computed(() => isNotAvailable(error.value) && !data.value)
const money = (m: NonNullable<typeof data.value>['total']) => formatVendorMoney(m, locale.value)
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString(locale.value) : t('app.notAvailable'))
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="data ? (data.number ?? t('vendor.invoices.draftNumber')) : t('vendor.invoices.details')" :back-to="backTo" />
    <UAlert v-if="unavailable" color="neutral" variant="subtle" icon="i-lucide-clock" :title="t('vendor.invoices.notAvailable')" :description="t('vendor.invoices.notAvailableHint')" />
    <SharedPageState v-else :loading="pending" :error="error" @retry="refresh">
      <div v-if="data" class="space-y-6">
        <UAlert color="neutral" variant="subtle" icon="i-lucide-info" :title="t('vendor.invoices.notOfficial')" :description="t('vendor.invoices.notOfficialHint')" />
        <UCard>
          <div class="flex flex-wrap items-center justify-between gap-3"><UBadge :color="invoiceStatusColor(data.status)" variant="subtle">{{ t(`vendor.invoices.status.${data.status}`) }}</UBadge><span class="text-sm text-muted">{{ t(`vendor.invoices.kind.${data.kind}`) }}</span></div>
          <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div><dt class="text-sm text-muted">{{ t('vendor.invoices.period') }}</dt><dd class="tabular-nums"><bdi dir="ltr">{{ data.period_start }} → {{ data.period_end }}</bdi></dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.invoices.issuedAt') }}</dt><dd>{{ date(data.issued_at) }}</dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.invoices.dueAt') }}</dt><dd>{{ date(data.due_at) }}</dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.invoices.paidAt') }}</dt><dd>{{ date(data.paid_at) }}</dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.invoices.customer') }}</dt><dd><NuxtLink :to="{ path: `/vendor/customers/${encodeURIComponent(data.customer_id)}` }">{{ t('vendor.invoices.openCustomer') }}</NuxtLink></dd></div>
          </dl>
        </UCard>
        <UCard><template #header><h2 class="font-semibold">{{ t('vendor.invoices.lines') }}</h2></template><VendorInvoiceLines :lines="data.lines" /></UCard>
        <UCard>
          <dl class="space-y-2 tabular-nums">
            <div class="flex justify-between gap-3"><dt class="text-muted">{{ t('vendor.invoices.subtotal') }}</dt><dd>{{ money(data.subtotal) }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-muted">{{ t('vendor.invoices.vat') }}</dt><dd>{{ money(data.tax) }}</dd></div>
            <div class="flex justify-between gap-3 font-semibold"><dt>{{ t('vendor.invoices.total') }}</dt><dd>{{ money(data.total) }}</dd></div>
          </dl>
          <p class="mt-2 text-xs text-muted">{{ t('vendor.invoices.vatNote') }}</p>
        </UCard>
        <UCard><template #header><h2 class="font-semibold">{{ t('vendor.invoices.attempts') }}</h2></template><p class="text-sm text-muted">{{ t('vendor.invoices.attemptsNone') }}</p></UCard>
        <UCard><template #header><h2 class="font-semibold">{{ t('vendor.invoices.adjustments') }}</h2></template>
          <p class="text-sm" :class="isCreditRelated(data) ? '' : 'text-muted'">{{ isCreditRelated(data) ? t('vendor.invoices.creditPending') : t('vendor.invoices.adjustmentsNone') }}</p>
          <p class="mt-1 text-xs text-muted">{{ t('vendor.invoices.immutable') }}</p>
        </UCard>
        <details class="text-sm"><summary class="cursor-pointer text-muted">{{ t('vendor.customers.technical') }}</summary>
          <dl class="mt-3 space-y-2"><div><dt>{{ t('vendor.invoices.techId') }}</dt><dd dir="ltr">{{ data.id }}</dd></div><div v-if="data.order_id"><dt>{{ t('vendor.invoices.techOrder') }}</dt><dd dir="ltr">{{ data.order_id }}</dd></div></dl>
        </details>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
