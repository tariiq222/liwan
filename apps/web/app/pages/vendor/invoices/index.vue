<script setup lang="ts">
import { formatVendorMoney } from '@/utils/vendorCommercial'
import { INVOICE_STATUS_FILTERS, invoiceListQuery, invoiceStatusColor, isInvoiceStatusFilter, isNotAvailable } from '@/utils/vendorSubscriptions'
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
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('vendor.invoices.title')" :description="t('vendor.invoices.description')" />
    <UAlert color="neutral" variant="subtle" icon="i-lucide-info" :title="t('vendor.invoices.notOfficial')" class="mb-4" />
    <SharedFilterBar :active-count="Number(Boolean(customerId)) + Number(status !== 'all')" @clear="router.replace('/vendor/invoices')">
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="status" :items="statusItems" :disabled="!hydrated" @update:model-value="patch({ status: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="customerId" :label="t('vendor.invoices.customerFilter')" @remove="patch({ customer_id: undefined })" /><SharedFilterChip v-if="status !== 'all'" :label="t(`vendor.invoices.filter.${status}`)" @remove="patch({ status: undefined })" /></template>
    </SharedFilterBar>
    <UAlert v-if="unavailable" color="neutral" variant="subtle" icon="i-lucide-clock" :title="t('vendor.invoices.notAvailable')" :description="t('vendor.invoices.notAvailableHint')" />
    <SharedPageState v-else :loading="pending" :error="error" :empty="!pending && !error && !items.length" :empty-text="t(customerId || status !== 'all' ? 'vendor.invoices.noResults' : 'vendor.invoices.empty')" @retry="refresh">
      <div class="space-y-4">
        <UCard v-for="i in items" :key="i.id" data-testid="invoice-row">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <h2 class="text-lg font-semibold"><NuxtLink :to="to(i.id)">{{ i.number ?? t('vendor.invoices.draftNumber') }}</NuxtLink></h2>
            <UBadge :color="invoiceStatusColor(i.status)" variant="subtle">{{ t(`vendor.invoices.status.${i.status}`) }}</UBadge>
          </div>
          <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt class="text-muted">{{ t('vendor.invoices.period') }}</dt><dd class="tabular-nums"><bdi dir="ltr">{{ i.period_start }} → {{ i.period_end }}</bdi></dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.vat') }}</dt><dd class="tabular-nums">{{ formatVendorMoney(i.tax, locale) }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.total') }}</dt><dd class="font-semibold tabular-nums">{{ formatVendorMoney(i.total, locale) }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.customer') }}</dt><dd><NuxtLink :to="{ path: `/vendor/customers/${encodeURIComponent(i.customer_id)}` }">{{ t('vendor.invoices.openCustomer') }}</NuxtLink></dd></div>
          </dl>
        </UCard>
      </div>
      <div v-if="data" class="mt-4 grid gap-3"><p class="text-sm text-muted">{{ t('vendor.pagination.total', { count: data.total }) }}</p><SharedPagination :page="page" :pages="pages" @update:page="value => patch({ page: value })" /></div>
    </SharedPageState>
  </SharedPageContainer>
</template>
