<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { invoiceStatusBadge } from '@liwan/commercial-ui/app/utils/commercialBadges'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { INVOICE_EXPORT_MAX_ROWS, riyadhDate } from '@liwan/commercial-contracts'
import { downloadCsv } from '@/utils/csv'
import { collectInvoices, INVOICE_EXPORT_COLUMNS, invoiceExportAudit, invoiceExportCsv, invoiceExportFileName, type InvoiceExportProgress } from '@/utils/invoiceExport'
import { formatBusinessDate } from '@/utils/vendorTime'
import { INVOICE_STATUS_FILTERS, invoiceListQuery, isInvoiceStatusFilter, isNotAvailable } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
definePageMeta({ capability: 'vendor.billing.manage' })
const { t, locale } = useI18n(); const route = useRoute(); const router = useRouter(); const hydrated = useHydrated(); const api = useVendorSubscriptions()
const PAGE = 25
const customerId = computed(() => (typeof route.query.customer_id === 'string' ? route.query.customer_id : ''))
const status = computed(() => (isInvoiceStatusFilter(route.query.status) ? route.query.status : 'all'))
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1))
function patch(change: Record<string, unknown>) { void router.replace({ path: '/invoices', query: { ...route.query, page: undefined, ...change } }) }
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:invoices:${customerId.value}:${status.value}:${page.value}`, () => api.listInvoices(invoiceListQuery({ customerId: customerId.value, status: status.value, page: page.value, pageSize: PAGE })), { watch: [customerId, status, page] })
// The customer filter searches commercial clients on the server; an invoice's own customer_name labels a filter set from a link.
const customerSearch = ref('')
const customerQuery = refDebounced(customerSearch, 250)
const { data: customers, error: customersError, refresh: refreshCustomers } = await useAsyncData('vendor:invoices:customers', () => api.listClients({ q: customerQuery.value.trim() || undefined }), { watch: [customerQuery] })
const unavailable = computed(() => isNotAvailable(error.value))
const items = computed(() => data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / PAGE)))
const statusItems = computed(() => INVOICE_STATUS_FILTERS.map(value => ({ value, label: t(`vendor.invoices.filter.${value}`) })))
const customerItems = computed(() => [{ value: '', label: t('vendor.invoices.allCustomers') }, ...(customers.value?.items ?? []).flatMap(c => (c.customer_id ? [{ value: c.customer_id, label: c.name }] : []))])
const customerLabel = computed(() => customerItems.value.find(c => c.value === customerId.value)?.label ?? items.value[0]?.customer_name ?? t('vendor.invoices.customerFilter'))
const to = (id: string) => ({ path: `/invoices/${encodeURIComponent(id)}`, query: { returnTo: route.fullPath } })
const customerTo = (id: string) => ({ path: `/customers/${encodeURIComponent(id)}` })
const date = (v: string | null) => (v ? formatBusinessDate(v) : null)
const outstanding = computed(() => {
  const sums = data.value?.summary.outstanding ?? []
  return sums.length ? sums.map(m => formatCommercialMoney(m, locale.value)).join(' · ') : '0'
})
const badge = (i: (typeof items.value)[number]) => invoiceStatusBadge(i.status, 'vendor.invoices.status')

// The export reads every invoice matching the current filters, not only this page, and writes one file in the browser.
const exporting = ref(false)
const exportProgress = ref<InvoiceExportProgress | null>(null)
const exportFailed = ref(false)
// Once the record is being written the export is committed: a recorded export always has its file, so Cancel is offered only while reading.
const exportRecording = ref(false)
let exportController: AbortController | null = null
const overCap = computed(() => (data.value?.total ?? 0) > INVOICE_EXPORT_MAX_ROWS)
async function exportCsv() {
  if (!hydrated.value || exporting.value) return
  exporting.value = true; exportFailed.value = false; exportProgress.value = null; exportRecording.value = false
  const controller = exportController = new AbortController()
  try {
    const filters = { customerId: customerId.value, status: status.value }
    const { rows, partial } = await collectInvoices(api.listInvoices, filters, { signal: controller.signal, onProgress: (progress) => { exportProgress.value = progress } })
    const csv = invoiceExportCsv(rows, { header: INVOICE_EXPORT_COLUMNS.map(column => t(`vendor.invoices.export.columns.${column}`)), kind: kind => t(`vendor.invoices.kind.${kind}`), status: value => t(invoiceStatusBadge(value, 'vendor.invoices.status').labelKey) })
    // The record comes first: when it is refused no file is made. From here the export can no longer be cancelled.
    exportRecording.value = true
    await api.recordInvoiceExport(invoiceExportAudit(filters, rows.length))
    downloadCsv(invoiceExportFileName(status.value, riyadhDate(new Date()), partial), csv)
  } catch (cause) {
    // A cancel is the vendor's own choice; any other failure leaves no file.
    if (!controller.signal.aborted) exportFailed.value = true
  } finally {
    exporting.value = false; exportRecording.value = false; exportProgress.value = null; exportController = null
  }
}
const cancelExport = () => { if (!exportRecording.value) exportController?.abort() }
onBeforeUnmount(cancelExport)

const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'number', header: t('vendor.invoices.details') },
  { id: 'customer', header: t('vendor.invoices.customer') },
  { id: 'status', header: t('vendor.common.status') },
  { id: 'due', header: t('vendor.invoices.dueAt') },
  { id: 'total', header: t('vendor.invoices.total') },
])
</script>
<template>
<SharedListPage :title="t('vendor.invoices.title')">

<template #filters><SharedFilterBar :active-count="Number(Boolean(customerId)) + Number(status !== 'all')" @clear="router.replace('/invoices')">
      <SharedFilterField :label="t('vendor.invoices.customer')" for="invoice-customer-filter">
        <USelectMenu id="invoice-customer-filter" v-model:search-term="customerSearch" :model-value="customerId" :items="customerItems" value-key="value" :ignore-filter="true" :search-input="{ placeholder: t('vendor.invoices.customerSearch') }" :disabled="!hydrated" class="w-56" @update:model-value="patch({ customer_id: $event || undefined })" />
        <UAlert v-if="customersError" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('vendor.invoices.customersLoadFailed')" :actions="[{ label: t('vendor.invoices.customersRetry'), onClick: () => refreshCustomers() }]" data-testid="invoice-customers-error" />
      </SharedFilterField>
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="status" :items="statusItems" :disabled="!hydrated" @update:model-value="patch({ status: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="customerId" :label="customerLabel" @remove="patch({ customer_id: undefined })" /><SharedFilterChip v-if="status !== 'all'" :label="t(`vendor.invoices.filter.${status}`)" @remove="patch({ status: undefined })" /></template>
    </SharedFilterBar></template>
<template #actions>
  <UButton v-if="exporting && !exportRecording" icon="i-lucide-x" variant="outline" color="neutral" data-testid="invoice-export-cancel" @click="cancelExport">{{ t('vendor.invoices.export.cancel') }}</UButton>
  <UButton icon="i-lucide-download" variant="outline" color="neutral" :loading="exporting" :disabled="!hydrated || exporting || !data?.total" data-testid="invoices-export" @click="exportCsv">{{ exportProgress ? t('vendor.invoices.export.progress', { done: exportProgress.done, total: exportProgress.total }) : t('vendor.invoices.export.action') }}</UButton>
</template>
<UAlert v-if="overCap" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('vendor.invoices.export.capped', { cap: INVOICE_EXPORT_MAX_ROWS })" data-testid="invoice-export-cap" />
<UAlert v-if="exportFailed" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('vendor.invoices.export.failed')" data-testid="invoice-export-failure" />
<p class="text-xs text-muted" data-testid="not-official"><span class="font-medium">{{ t('vendor.invoices.notOfficial') }}</span> — {{ t('vendor.invoices.notOfficialHint') }}</p>
<UAlert v-if="unavailable" color="neutral" variant="subtle" icon="i-lucide-clock" :title="t('vendor.invoices.notAvailable')" :description="t('vendor.invoices.notAvailableHint')" />
<template v-else>
<div v-if="data" data-testid="invoices-summary">
  <SharedMetricTile :label="t('vendor.invoices.summary.outstanding')" :value="outstanding" icon="i-lucide-wallet" value-dir="ltr" data-testid="invoices-outstanding" />
</div>
<p v-if="data" class="text-sm text-muted" data-testid="invoices-result-count">{{ t('vendor.pagination.total', { count: data.total }, data.total) }}</p>
<SharedDataTable :rows="items" :columns="columns" row-key="id" :row-to="i => to(i.id)" :loading="pending" :error="error" :empty-text="t(customerId || status !== 'all' ? 'vendor.invoices.noResults' : 'vendor.invoices.empty')" :caption="t('vendor.invoices.title')" @retry="refresh" :page="page" :pages="pages" @update:page="value => patch({ page: value })">
  <template #number-cell="{ row: { original: i } }"><NuxtLink :to="to(i.id)" data-testid="invoice-row" class="font-medium hover:underline">{{ i.number ?? t('vendor.invoices.draftNumber') }}</NuxtLink></template>
  <template #customer-cell="{ row: { original: i } }"><NuxtLink :to="customerTo(i.customer_id)" class="hover:underline">{{ i.customer_name }}</NuxtLink></template>
  <template #status-cell="{ row: { original: i } }"><SharedStatusBadge :tone="badge(i).tone" :label="t(badge(i).labelKey)" /></template>
  <template #due-cell="{ row: { original: i } }">{{ date(i.due_at) ?? t('app.notAvailable') }}</template>
  <template #total-cell="{ row: { original: i } }"><bdi dir="ltr" class="font-semibold tabular-nums">{{ formatCommercialMoney(i.total, locale) }}</bdi></template>
  <template #mobile-row="{ row: i }"><div class="flex flex-wrap items-start justify-between gap-4">
            <h2 class="text-lg font-semibold"><NuxtLink data-testid="invoice-row" :to="to(i.id)">{{ i.number ?? t('vendor.invoices.draftNumber') }}</NuxtLink></h2>
            <SharedStatusBadge :tone="badge(i).tone" :label="t(badge(i).labelKey)" />
          </div>
          <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt class="text-muted">{{ t('vendor.invoices.customer') }}</dt><dd><NuxtLink :to="customerTo(i.customer_id)">{{ i.customer_name }}</NuxtLink></dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.period') }}</dt><dd class="tabular-nums"><bdi dir="ltr">{{ i.period_start }} → {{ i.period_end }}</bdi></dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.dueAt') }}</dt><dd>{{ date(i.due_at) ?? t('app.notAvailable') }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.invoices.total') }}</dt><dd class="font-semibold tabular-nums">{{ formatCommercialMoney(i.total, locale) }}</dd></div>
          </dl></template>
</SharedDataTable>
</template>
</SharedListPage>
</template>
