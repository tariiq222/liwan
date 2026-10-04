<script setup lang="ts">
import { cadenceLabel, commercialReturnTo, formatVendorMoney, isStatusFilter, keyLabel, limitLabel, STATUS_FILTERS, type PlanView } from '@/utils/vendorCommercial'
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
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('vendor.plans.title')" :description="t('vendor.plans.description')"><template #actions><UButton v-if="can('vendor.catalog.manage') && can('vendor.pricing.manage')" :to="{ path: '/vendor/plans/new', query: { returnTo: listTo } }" icon="i-lucide-plus">{{ t('vendor.plans.create') }}</UButton></template></SharedPageHeader>
    <SharedFilterBar :active-count="Number(Boolean(q)) + Number(status !== 'all')" @clear="router.replace('/vendor/plans')">
      <template #search><UInput :model-value="q" :aria-label="t('vendor.plans.search')" :placeholder="t('vendor.plans.search')" icon="i-lucide-search" :disabled="!hydrated" @update:model-value="patch({ q: $event || undefined })" /></template>
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="status" :items="statusItems" :disabled="!hydrated" @update:model-value="patch({ status: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="q" :label="q" @remove="patch({ q: undefined })" /><SharedFilterChip v-if="status !== 'all'" :label="t(`vendor.pricing.filter.${status}`)" @remove="patch({ status: undefined })" /></template>
    </SharedFilterBar>
    <SharedPageState :loading="pending" :error="error" :empty="!pending && !error && !items.length" :empty-text="t(q || status !== 'all' ? 'vendor.plans.noResults' : 'vendor.plans.empty')" @retry="refresh">
      <div class="space-y-4">
        <UCard v-for="p in items" :key="p.id" data-testid="plan-row">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0"><h2 class="text-lg font-semibold"><NuxtLink :to="path(p)">{{ p.name }}</NuxtLink> <SharedRecordNumber :value="`v${p.version}`" /></h2><p class="mt-1 text-sm text-muted">{{ t('vendor.plans.termMonths', { count: p.term_months }) }}</p></div>
            <VendorLifecycleBadge :status="p.status" :available="p.available" />
          </div>
          <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums"><li v-for="pr in p.prices" :key="`${pr.cadence.unit}${pr.cadence.count}`">{{ cadenceLabel(pr.cadence, t) }}: <span class="font-medium">{{ formatVendorMoney(pr.amount, locale) }}</span></li></ul>
          <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted"><li v-for="(v, k) in p.platform_limits" :key="k">{{ keyLabel(String(k), t, te) }}: {{ limitLabel(v, t) }}</li><li>{{ t('vendor.plans.bundlesCount', { included: p.included_bundle_revision_ids.length, optional: p.optional_bundle_revision_ids.length }) }}</li></ul>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-2"><p class="text-sm text-muted">{{ t('vendor.pricing.customers', { count: p.customer_count }) }}</p><UButton :to="path(p)" color="neutral" variant="link">{{ t(`vendor.pricing.next.${nextKey(p)}`) }}</UButton></div>
        </UCard>
      </div>
      <div v-if="data" class="mt-4 grid gap-3"><p class="text-sm text-muted">{{ t('vendor.pagination.total', { count: data.total }) }}</p><SharedPagination :page="page" :pages="pages" @update:page="value => patch({ page: value })" /></div>
    </SharedPageState>
  </SharedPageContainer>
</template>
