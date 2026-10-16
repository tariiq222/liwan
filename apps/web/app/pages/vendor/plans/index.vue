<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { lifecycleBadge } from '@/utils/vendorCommercial'
import { cadenceLabel, formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'
import { commercialReturnTo, isStatusFilter, keyLabel, limitLabel, STATUS_FILTERS, type PlanView } from '@/utils/vendorCommercial'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t, te, locale } = useI18n(); const route = useRoute(); const router = useRouter(); const { can } = useVendorContext(); const hydrated = useHydrated(); const api = useVendorCommercial()
const PAGE = 25
const isNew = computed(() => route.path.replace(/\/+$/, '').endsWith('/new'))
const listQuery = computed<Record<string, unknown>>(() => (isNew.value ? Object.fromEntries(new URL(commercialReturnTo(route.query.returnTo, '/vendor/plans'), 'http://nasq.local').searchParams) : route.query))
const q = computed(() => (typeof listQuery.value.q === 'string' ? listQuery.value.q : ''))
const status = computed(() => (isStatusFilter(listQuery.value.status) ? listQuery.value.status : 'all'))
const page = computed(() => Math.max(1, Number(listQuery.value.page ?? 1) || 1))
const listTo = computed(() => commercialReturnTo(isNew.value ? route.query.returnTo : route.fullPath, '/vendor/plans'))
function patch(change: Record<string, unknown>) { void router.replace({ path: '/vendor/plans', query: { ...listQuery.value, page: undefined, ...change } }) }
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:plans:${q.value}:${status.value}:${page.value}`, () => api.listPlans({ q: q.value, status: status.value, limit: PAGE, offset: (page.value - 1) * PAGE }), { watch: [q, status, page] })
const items = computed<PlanView[]>(() => data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / PAGE)))
const path = (p: PlanView) => ({ path: `/vendor/plans/${encodeURIComponent(p.id)}`, query: { returnTo: listTo.value } })
const statusItems = computed(() => STATUS_FILTERS.map(value => ({ value, label: t(`vendor.pricing.filter.${value}`) })))
const nextKey = (p: PlanView) => (p.status === 'draft' ? 'validate' : p.status === 'validated' ? 'publish' : p.available ? 'view' : 'restore')

const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'name', header: t('vendor.plans.title') },
  { id: 'status', header: t('vendor.common.status') },
  { id: 'prices', header: t('vendor.pricing.sections.prices') },
  { id: 'limits', header: t('vendor.pricing.sections.limits') },
  { id: 'bundles', header: t('vendor.pricing.sections.bundles') },
  { id: 'customers', header: t('vendor.customers.title') },
])
</script>
<template>
<SharedListPage :title="t('vendor.plans.title')" :description="t('vendor.plans.description')" :create-to="can('vendor.catalog.manage') && can('vendor.pricing.manage') ? { path: '/vendor/plans/new', query: { returnTo: listTo } } : undefined" :create-label="t('vendor.plans.create')" create-test-id="vendor-plan-new">

<template #filters><SharedFilterBar :active-count="Number(Boolean(q)) + Number(status !== 'all')" @clear="router.replace('/vendor/plans')">
      <template #search><UInput :model-value="q" :aria-label="t('vendor.plans.search')" :placeholder="t('vendor.plans.search')" icon="i-lucide-search" :disabled="!hydrated" @update:model-value="patch({ q: $event || undefined })" /></template>
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="status" :items="statusItems" :disabled="!hydrated" @update:model-value="patch({ status: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="q" :label="q" @remove="patch({ q: undefined })" /><SharedFilterChip v-if="status !== 'all'" :label="t(`vendor.pricing.filter.${status}`)" @remove="patch({ status: undefined })" /></template>
    </SharedFilterBar></template>
<p v-if="data" class="text-sm text-muted" data-testid="plans-result-count">{{ t('vendor.pagination.total', { count: data.total }, data.total) }}</p>

<SharedDataTable  :rows="items" :columns="columns" row-key="id" :row-to="path" :loading="pending" :error="error" :empty-text="t(q || status !== 'all' ? 'vendor.plans.noResults' : 'vendor.plans.empty')" :caption="t('vendor.plans.title')" @retry="refresh" :page="page" :pages="pages" @update:page="value => patch({ page: value })">
  <template #name-cell="{ row: { original: p } }"><NuxtLink :to="path(p)" data-testid="plan-row" class="font-medium hover:underline">{{ p.name }}</NuxtLink> <SharedRecordNumber :value="`v${p.version}`" /></template>
  <template #status-cell="{ row: { original: p } }"><SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(p).tone" :label="lifecycleBadge(p).labelKey ? t(lifecycleBadge(p).labelKey) : p.status" /></template>
  <template #prices-cell="{ row: { original: p } }"><ul><li v-for="pr in p.prices" :key="`${pr.cadence.unit}${pr.cadence.count}`">{{ cadenceLabel(pr.cadence, t) }}: <bdi dir="ltr">{{ formatCommercialMoney(pr.amount, locale) }}</bdi></li></ul></template>
  <template #limits-cell="{ row: { original: p } }"><ul><li v-for="(v,k) in p.platform_limits" :key="k">{{ keyLabel(String(k),t,te) }}: {{ limitLabel(v,t) }}</li></ul></template>
  <template #bundles-cell="{ row: { original: p } }">{{ t('vendor.plans.bundlesCount', {included:p.included_bundle_revision_ids.length, optional:p.optional_bundle_revision_ids.length}) }}</template>
  <template #customers-cell="{ row: { original: p } }">{{ t('vendor.pricing.customers', {count:p.customer_count}, p.customer_count) }}</template>
  <template #mobile-row="{ row: p }"><div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0"><h2 class="text-lg font-semibold"><NuxtLink data-testid="plan-row" :to="path(p)">{{ p.name }}</NuxtLink> <SharedRecordNumber :value="`v${p.version}`" /></h2><p class="mt-1 text-sm text-muted">{{ t('vendor.plans.termMonths', { count: p.term_months }, p.term_months) }}</p></div>
            <SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(p).tone" :label="t(lifecycleBadge(p).labelKey)" />
          </div>
          <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums"><li v-for="pr in p.prices" :key="`${pr.cadence.unit}${pr.cadence.count}`">{{ cadenceLabel(pr.cadence, t) }}: <span class="font-medium">{{ formatCommercialMoney(pr.amount, locale) }}</span></li></ul>
          <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted"><li v-for="(v, k) in p.platform_limits" :key="k">{{ keyLabel(String(k), t, te) }}: {{ limitLabel(v, t) }}</li><li>{{ t('vendor.plans.bundlesCount', { included: p.included_bundle_revision_ids.length, optional: p.optional_bundle_revision_ids.length }) }}</li></ul>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-2"><p class="text-sm text-muted">{{ t('vendor.pricing.customers', { count: p.customer_count }, p.customer_count) }}</p><UButton :to="path(p)" color="neutral" variant="link">{{ t(`vendor.pricing.next.${nextKey(p)}`) }}</UButton></div></template>
</SharedDataTable>
</SharedListPage>
</template>
