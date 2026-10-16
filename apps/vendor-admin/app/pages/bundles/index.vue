<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { lifecycleBadge } from '@/utils/vendorCommercial'
import { appName, commercialReturnTo, isStatusFilter, keyLabel, limitLabel, STATUS_FILTERS, type BundleView } from '@/utils/vendorCommercial'
import { formatCommercialMoney, cadenceLabel } from '@nasq/commercial-ui/app/utils/commercial'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ capability: 'vendor.read' })
const { t, te, locale } = useI18n(); const route = useRoute(); const router = useRouter(); const { can } = useVendorContext(); const hydrated = useHydrated(); const api = useVendorCommercial()
const PAGE = 25
const isNew = computed(() => route.path.replace(/\/+$/, '').endsWith('/new'))
const listQuery = computed<Record<string, unknown>>(() => (isNew.value ? Object.fromEntries(new URL(commercialReturnTo(route.query.returnTo, '/bundles'), 'http://nasq.local').searchParams) : route.query))
const q = computed(() => (typeof listQuery.value.q === 'string' ? listQuery.value.q : ''))
const status = computed(() => (isStatusFilter(listQuery.value.status) ? listQuery.value.status : 'all'))
const page = computed(() => Math.max(1, Number(listQuery.value.page ?? 1) || 1))
const listTo = computed(() => commercialReturnTo(isNew.value ? route.query.returnTo : route.fullPath, '/bundles'))
function patch(change: Record<string, unknown>) { void router.replace({ path: '/bundles', query: { ...listQuery.value, page: undefined, ...change } }) }
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:bundles:${q.value}:${status.value}:${page.value}`, async () => {
  const [bundles, releases] = await Promise.all([api.listBundles({ q: q.value, status: status.value, limit: PAGE, offset: (page.value - 1) * PAGE }), api.releases().catch(() => [])])
  return { bundles, releases }
}, { watch: [q, status, page] })
const items = computed<BundleView[]>(() => data.value?.bundles.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((data.value?.bundles.total ?? 0) / PAGE)))
const releaseOf = (b: BundleView) => data.value?.releases.find(r => r.id === b.catalog_release_id)
const apps = (b: BundleView) => b.selections.map(s => { const a = releaseOf(b)?.applications.find(x => x.id === s.app_id); return a ? appName(a, locale.value) : s.app_id })
const limits = (b: BundleView) => Object.entries(b.domain_limits).map(([k, v]) => `${keyLabel(k, t, te)}: ${limitLabel(v, t)}`)
const nextKey = (b: BundleView) => (b.status === 'draft' ? 'validate' : b.status === 'validated' ? 'publish' : b.available ? 'view' : 'restore')
const path = (b: BundleView) => ({ path: `/bundles/${encodeURIComponent(b.id)}`, query: { returnTo: listTo.value } })
const statusItems = computed(() => STATUS_FILTERS.map(value => ({ value, label: t(`vendor.pricing.filter.${value}`) })))

const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'name', header: t('vendor.bundles.title') },
  { id: 'status', header: t('vendor.common.status') },
  { id: 'apps', header: t('vendor.pricing.sections.included') },
  { id: 'limits', header: t('vendor.pricing.sections.limits') },
  { id: 'prices', header: t('vendor.pricing.sections.prices') },
  { id: 'customers', header: t('vendor.customers.title') },
])
</script>
<template>
<SharedListPage :title="t('vendor.bundles.title')" :description="t('vendor.bundles.description')" :create-to="can('vendor.catalog.manage') ? { path: '/bundles/new', query: { returnTo: listTo } } : undefined" :create-label="t('vendor.bundles.create')" create-test-id="vendor-bundle-new">

<template #filters><SharedFilterBar :active-count="Number(Boolean(q)) + Number(status !== 'all')" @clear="router.replace('/bundles')">
      <template #search><UInput :model-value="q" :aria-label="t('vendor.bundles.search')" :placeholder="t('vendor.bundles.search')" icon="i-lucide-search" :disabled="!hydrated" @update:model-value="patch({ q: $event || undefined })" /></template>
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="status" :items="statusItems" :disabled="!hydrated" @update:model-value="patch({ status: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="q" :label="q" @remove="patch({ q: undefined })" /><SharedFilterChip v-if="status !== 'all'" :label="t(`vendor.pricing.filter.${status}`)" @remove="patch({ status: undefined })" /></template>
    </SharedFilterBar></template>
<p v-if="data" class="text-sm text-muted" data-testid="bundles-result-count">{{ t('vendor.pagination.total', { count: data.bundles.total }, data.bundles.total) }}</p>

<SharedDataTable  :rows="items" :columns="columns" row-key="id" :row-to="path" :loading="pending" :error="error" :empty-text="t(q || status !== 'all' ? 'vendor.bundles.noResults' : 'vendor.bundles.empty')" :caption="t('vendor.bundles.title')" @retry="refresh" :page="page" :pages="pages" @update:page="value => patch({ page: value })">
  <template #name-cell="{ row: { original: b } }"><NuxtLink :to="path(b)" data-testid="bundle-row" class="font-medium hover:underline">{{ b.name }}</NuxtLink> <SharedRecordNumber :value="`v${b.version}`" /></template>
  <template #status-cell="{ row: { original: b } }"><SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(b).tone" :label="lifecycleBadge(b).labelKey ? t(lifecycleBadge(b).labelKey) : b.status" /></template>
  <template #apps-cell="{ row: { original: b } }"><div class="flex flex-wrap gap-1"><UBadge v-for="a in apps(b)" :key="a" color="neutral" variant="subtle">{{ a }}</UBadge></div></template>
  <template #limits-cell="{ row: { original: b } }">{{ limits(b).join(' · ') }}</template>
  <template #prices-cell="{ row: { original: b } }"><ul><li v-for="p in b.prices" :key="`${p.cadence.unit}${p.cadence.count}`">{{ cadenceLabel(p.cadence,t) }}: <bdi dir="ltr">{{ formatCommercialMoney(p.amount,locale) }}</bdi></li></ul></template>
  <template #customers-cell="{ row: { original: b } }">{{ t('vendor.pricing.customers', {count:b.customer_count}, b.customer_count) }}</template>
  <template #mobile-row="{ row: b }"><div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0"><h2 class="text-lg font-semibold"><NuxtLink data-testid="bundle-row" :to="path(b)">{{ b.name }}</NuxtLink> <SharedRecordNumber :value="`v${b.version}`" /></h2><p class="mt-1 text-sm text-muted">{{ b.description }}</p></div>
            <SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(b).tone" :label="t(lifecycleBadge(b).labelKey)" />
          </div>
          <div class="mt-3 flex flex-wrap gap-2"><UBadge v-for="a in apps(b)" :key="a" color="neutral" variant="subtle">{{ a }}</UBadge><span v-if="!b.selections.length" class="text-sm text-muted">{{ t('vendor.pricing.summary.noApps') }}</span></div>
          <ul v-if="limits(b).length" class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted"><li v-for="l in limits(b)" :key="l">{{ l }}</li></ul>
          <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums"><li v-for="p in b.prices" :key="`${p.cadence.unit}${p.cadence.count}`">{{ cadenceLabel(p.cadence, t) }}: <span class="font-medium">{{ formatCommercialMoney(p.amount, locale) }}</span></li><li v-if="!b.prices.length" class="text-warning">{{ t('vendor.pricing.prices.none') }}</li></ul>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-2"><p class="text-sm text-muted">{{ t('vendor.pricing.customers', { count: b.customer_count }, b.customer_count) }}</p><UButton :to="path(b)" color="neutral" variant="link">{{ t(`vendor.pricing.next.${nextKey(b)}`) }}</UButton></div></template>
</SharedDataTable>
</SharedListPage>
</template>
