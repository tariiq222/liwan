<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { invoiceStatusBadge } from '@/utils/commercialBadges'
import { formatVendorMoney } from '@/utils/vendorCommercial'
import { INVOICE_STATUS_FILTERS, invoiceListQuery, isInvoiceStatusFilter, isNotAvailable } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.billing.manage' })
const { t, locale } = useI18n(); const route = useRoute(); const router = useRouter(); const hydrated = useHydrated(); const api = useVendorSubscriptions()
const PAGE = 25
const customerId = computed(() => (typeof route.query.customer_id === 'string' ? route.query.customer_id : ''))
const status = computed(() => (isInvoiceStatusFilter(route.query.status) ? route.query.status : 'all'))
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1))
function patch(change: Record<string, unknown>) { void router.replace({ path: '/vendor/invoices', query: { ...route.query, page: undefined, ...change } }) }
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:invoices:${customerId.value}:${status.value}:${page.value}`, () => api.listInvoices(invoiceListQuery({ customerId: customerId.value, status: status.value, page: page.value, pageSize: PAGE })), { watch: [customerId, status, page] })
const unavailable = computed(() => isNotAvailable(error.value))
const items = computed(() => data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / PAGE)))
const statusItems = computed(() => INVOICE_STATUS_FILTERS.map(value => ({ value, label: t(`vendor.invoices.filter.${value}`) })))
const to = (id: string) => ({ path: `/vendor/invoices/${encodeURIComponent(id)}`, query: { returnTo: route.fullPath } })

const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'number', header: t('vendor.invoices.details') },
  { id: 'status', header: t('vendor.common.status') },
  { id: 'period', header: t('vendor.invoices.period') },
  { id: 'vat', header: t('vendor.invoices.vat') },
  { id: 'total', header: t('vendor.invoices.total') },
  { id: 'customer', header: t('vendor.invoices.customer') },
])
</script>
<template>
<SharedListPage :title="t('vendor.invoices.title')" :description="t('vendor.invoices.description')">

<template #filters><SharedFilterBar :active-count="Number(Boolean(customerId)) + Number(status !== 'all')" @clear="router.replace('/vendor/invoices')">
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="status" :items="statusItems" :disabled="!hydrated" @update:model-value="patch({ status: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="customerId" :label="t('vendor.invoices.customerFilter')" @remove="patch({ customer_id: undefined })" /><SharedFilterChip v-if="status !== 'all'" :label="t(`vendor.invoices.filter.${status}`)" @remove="patch({ status: undefined })" /></template>
    </SharedFilterBar></template>
<p v-if="data" class="text-sm text-muted" data-testid="invoices-result-count">{{ t('vendor.pagination.total', { count: data.total }) }}</p>
<UAlert data-testid="not-official" color="neutral" variant="subtle" icon="i-lucide-info" :title="t('vendor.invoices.notOfficial')" class="mb-4" /><UAlert v-if="unavailable" color="neutral" variant="subtle" icon="i-lucide-clock" :title="t('vendor.invoices.notAvailable')" :description="t('vendor.invoices.notAvailableHint')" />
<SharedDataTable v-else :rows="items" :columns="columns" row-key="id" :row-to="i => to(i.id)" :loading="pending" :error="error" :empty-text="t(customerId || status !== 'all' ? 'vendor.invoices.noResults' : 'vendor.invoices.empty')" :caption="t('vendor.invoices.title')" @retry="refresh" :page="page" :pages="pages" @update:page="value => patch({ page: value })">
  <template #number-cell="{ row: { original: i } }"><NuxtLink :to="to(i.id)" data-testid="invoice-row" class="font-medium hover:underline">{{ i.number ?? t('vendor.invoices.draftNumber') }}</NuxtLink></template>
  <template #status-cell="{ row: { original: i } }"><SharedStatusBadge  :tone="invoiceStatusBadge(i.status, 'vendor.invoices.status').tone" :label="invoiceStatusBadge(i.status, 'vendor.invoices.status').labelKey ? t(invoiceStatusBadge(i.status, 'vendor.invoices.status').labelKey) : i.status" /></template>
  <template #period-cell="{ row: { original: i } }"><bdi dir="ltr">{{ i.period_start }} → {{ i.period_end }}</bdi></template>
  <template #vat-cell="{ row: { original: i } }"><bdi dir="ltr">{{ formatVendorMoney(i.tax, locale) }}</bdi></template>
  <template #total-cell="{ row: { original: i } }"><bdi dir="ltr" class="font-semibold tabular-nums">{{ formatVendorMoney(i.total, locale) }}</bdi></template>
  <template #customer-cell="{ row: { original: i } }"><NuxtLink :to="{ path: `/vendor/customers/${encodeURIComponent(i.customer_id)}` }">{{ t('vendor.invoices.openCustomer') }}</NuxtLink></template>
  <template #mobile-row="{ row: i }"><div class="flex flex-wrap items-start justify-between gap-4">
            <h2 class="text-lg font-semibold"><NuxtLink data-testid="invoice-row" :to="to(i.id)">{{ i.number ?? t('vendor.invoices.draftNumber') }}</NuxtLink></h2>
            <SharedStatusBadge  :tone="invoiceStatusBadge(i.status, 'vendor.invoices.status').tone" :label="invoiceStatusBadge(i.status, 'vendor.invoices.status').labelKey ? t(invoiceStatusBadge(i.status, 'vendor.invoices.status').labelKey) : i.status" />
          </div>
          <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt class="text-muted">{{ t('vendor.invoices.period') }}</dt><dd class="tabular-nums"><bdi dir="ltr">{{ i.period_start }} → {{ i.period_end }}</bdi></dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.vat') }}</dt><dd class="tabular-nums">{{ formatVendorMoney(i.tax, locale) }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.total') }}</dt><dd class="font-semibold tabular-nums">{{ formatVendorMoney(i.total, locale) }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.customer') }}</dt><dd><NuxtLink :to="{ path: `/vendor/customers/${encodeURIComponent(i.customer_id)}` }">{{ t('vendor.invoices.openCustomer') }}</NuxtLink></dd></div>
          </dl></template>
</SharedDataTable>
</SharedListPage>
</template>
