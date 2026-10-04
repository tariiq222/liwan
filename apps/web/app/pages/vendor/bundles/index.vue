<script setup lang="ts">
import { appName, commercialReturnTo, formatVendorMoney, cadenceLabel, isStatusFilter, keyLabel, limitLabel, STATUS_FILTERS, type BundleView } from '@/utils/vendorCommercial'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t, te, locale } = useI18n(); const route = useRoute(); const router = useRouter(); const { can } = useVendorContext(); const hydrated = useHydrated(); const api = useVendorCommercial()
const PAGE = 25
const isNew = computed(() => route.path.replace(/\/+$/, '').endsWith('/new'))
const listQuery = computed<Record<string, unknown>>(() => (isNew.value ? Object.fromEntries(new URL(commercialReturnTo(route.query.returnTo, '/vendor/bundles'), 'http://nasq.local').searchParams) : route.query))
const q = computed(() => (typeof listQuery.value.q === 'string' ? listQuery.value.q : ''))
const status = computed(() => (isStatusFilter(listQuery.value.status) ? listQuery.value.status : 'all'))
const page = computed(() => Math.max(1, Number(listQuery.value.page ?? 1) || 1))
const listTo = computed(() => commercialReturnTo(isNew.value ? route.query.returnTo : route.fullPath, '/vendor/bundles'))
function patch(change: Record<string, unknown>) { void router.replace({ path: '/vendor/bundles', query: { ...listQuery.value, page: undefined, ...change } }) }
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
const path = (b: BundleView) => ({ path: `/vendor/bundles/${encodeURIComponent(b.id)}`, query: { returnTo: listTo.value } })
const statusItems = computed(() => STATUS_FILTERS.map(value => ({ value, label: t(`vendor.pricing.filter.${value}`) })))
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('vendor.bundles.title')" :description="t('vendor.bundles.description')"><template #actions><UButton v-if="can('vendor.catalog.manage')" :to="{ path: '/vendor/bundles/new', query: { returnTo: listTo } }" icon="i-lucide-plus">{{ t('vendor.bundles.create') }}</UButton></template></SharedPageHeader>
    <SharedFilterBar :active-count="Number(Boolean(q)) + Number(status !== 'all')" @clear="router.replace('/vendor/bundles')">
      <template #search><UInput :model-value="q" :aria-label="t('vendor.bundles.search')" :placeholder="t('vendor.bundles.search')" icon="i-lucide-search" :disabled="!hydrated" @update:model-value="patch({ q: $event || undefined })" /></template>
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="status" :items="statusItems" :disabled="!hydrated" @update:model-value="patch({ status: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="q" :label="q" @remove="patch({ q: undefined })" /><SharedFilterChip v-if="status !== 'all'" :label="t(`vendor.pricing.filter.${status}`)" @remove="patch({ status: undefined })" /></template>
    </SharedFilterBar>
    <SharedPageState :loading="pending" :error="error" :empty="!pending && !error && !items.length" :empty-text="t(q || status !== 'all' ? 'vendor.bundles.noResults' : 'vendor.bundles.empty')" @retry="refresh">
      <div class="space-y-4">
        <UCard v-for="b in items" :key="b.id" data-testid="bundle-row">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0"><h2 class="text-lg font-semibold"><NuxtLink :to="path(b)">{{ b.name }}</NuxtLink> <SharedRecordNumber :value="`v${b.version}`" /></h2><p class="mt-1 text-sm text-muted">{{ b.description }}</p></div>
            <VendorLifecycleBadge :status="b.status" :available="b.available" />
          </div>
          <div class="mt-3 flex flex-wrap gap-2"><UBadge v-for="a in apps(b)" :key="a" color="neutral" variant="subtle">{{ a }}</UBadge><span v-if="!b.selections.length" class="text-sm text-muted">{{ t('vendor.pricing.summary.noApps') }}</span></div>
          <ul v-if="limits(b).length" class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted"><li v-for="l in limits(b)" :key="l">{{ l }}</li></ul>
          <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums"><li v-for="p in b.prices" :key="`${p.cadence.unit}${p.cadence.count}`">{{ cadenceLabel(p.cadence, t) }}: <span class="font-medium">{{ formatVendorMoney(p.amount, locale) }}</span></li><li v-if="!b.prices.length" class="text-warning">{{ t('vendor.pricing.prices.none') }}</li></ul>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-2"><p class="text-sm text-muted">{{ t('vendor.pricing.customers', { count: b.customer_count }) }}</p><UButton :to="path(b)" color="neutral" variant="link">{{ t(`vendor.pricing.next.${nextKey(b)}`) }}</UButton></div>
        </UCard>
      </div>
      <div v-if="data" class="mt-4 grid gap-3"><p class="text-sm text-muted">{{ t('vendor.pagination.total', { count: data.bundles.total }) }}</p><SharedPagination :page="page" :pages="pages" @update:page="value => patch({ page: value })" /></div>
    </SharedPageState>
  </SharedPageContainer>
</template>
