<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { customerDisplayBadge } from '@/utils/commercialBadges'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
import { CUSTOMER_STATE_FILTERS, customerDisplayState, customerListQuery, isCustomerStateFilter, isNotAvailable, type VendorCustomer } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { entitledFeaturePrefixes } from '@/utils/entitlementApps'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t } = useI18n(); const route = useRoute(); const router = useRouter(); const hydrated = useHydrated(); const api = useVendorSubscriptions()
const PAGE = 25
const q = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))
const state = computed(() => (isCustomerStateFilter(route.query.state) ? route.query.state : 'all'))
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1))
function patch(change: Record<string, unknown>) { void router.replace({ path: '/vendor/customers', query: { ...route.query, page: undefined, ...change } }) }
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:customers:${q.value}:${state.value}:${page.value}`, () => api.listCustomers(customerListQuery({ q: q.value, state: state.value, page: page.value, pageSize: PAGE })), { watch: [q, state, page] })
const { data: plans } = await useAsyncData('vendor:customers:plans', () => useVendorCommercial().listPlans({ limit: 200 }).then(r => r.items).catch(() => []))
const planName = (id: string) => plans.value?.find(p => p.id === id)?.name
const unavailable = computed(() => isNotAvailable(error.value))
const items = computed<VendorCustomer[]>(() => data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / PAGE)))
const stateItems = computed(() => CUSTOMER_STATE_FILTERS.map(value => ({ value, label: t(`vendor.customers.filter.${value}`) })))
const to = (c: VendorCustomer) => ({ path: `/vendor/customers/${encodeURIComponent(c.id)}`, query: { returnTo: route.fullPath } })
const planOf = (c: VendorCustomer) => (c.subscription?.applied ? planName(c.subscription.applied.plan_revision_id) ?? t('vendor.customers.planAssigned') : t('vendor.customers.noPlan'))
const services = (c: VendorCustomer) => (c.subscription?.applied ? entitledFeaturePrefixes(c.subscription.applied.entitlement.features).length : null)
const branches = (c: VendorCustomer) => (c.subscription?.applied ? 1 + c.subscription.applied.extra_branch_count : null)

const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'name', header: t('vendor.customers.title') },
  { id: 'status', header: t('vendor.common.status') },
  { id: 'plan', header: t('vendor.customers.plan') },
  { id: 'services', header: t('vendor.customers.services') },
  { id: 'branches', header: t('vendor.customers.branches') },
  { id: 'renewal', header: t('vendor.customers.renewal') },
])
</script>
<template>
<SharedListPage :title="t('vendor.customers.title')" :description="t('vendor.customers.description')">

<template #filters><SharedFilterBar :active-count="Number(Boolean(q)) + Number(state !== 'all')" @clear="router.replace('/vendor/customers')">
      <template #search><UInput :model-value="q" :aria-label="t('vendor.customers.search')" :placeholder="t('vendor.customers.search')" icon="i-lucide-search" :disabled="!hydrated" @update:model-value="patch({ q: $event || undefined })" /></template>
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="state" :items="stateItems" :disabled="!hydrated" @update:model-value="patch({ state: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="q" :label="q" @remove="patch({ q: undefined })" /><SharedFilterChip v-if="state !== 'all'" :label="t(`vendor.customers.filter.${state}`)" @remove="patch({ state: undefined })" /></template>
    </SharedFilterBar></template>
<p v-if="data" class="text-sm text-muted" data-testid="customers-result-count">{{ t('vendor.pagination.total', { count: data.total }, data.total) }}</p>
<UAlert v-if="unavailable" color="neutral" variant="subtle" icon="i-lucide-clock" :title="t('vendor.customers.notAvailable')" :description="t('vendor.customers.notAvailableHint')" />
<SharedDataTable v-else :rows="items" :columns="columns" row-key="id" :row-to="to" :loading="pending" :error="error" :empty-text="t(q || state !== 'all' ? 'vendor.customers.noResults' : 'vendor.customers.empty')" :caption="t('vendor.customers.title')" @retry="refresh" :page="page" :pages="pages" @update:page="value => patch({ page: value })">
  <template #name-cell="{ row: { original: c } }"><NuxtLink :to="to(c)" data-testid="customer-row" class="font-medium hover:underline">{{ c.name }}</NuxtLink></template>
  <template #status-cell="{ row: { original: c } }"><SharedStatusBadge v-if="c.commercial_setup_required" tone="warning" :label="t('vendor.customers.setupRequired')" data-testid="setup-required" /><SharedStatusBadge v-if="customerDisplayState(c)" :tone="customerDisplayBadge(customerDisplayState(c)!).tone" :label="customerDisplayBadge(customerDisplayState(c)!).labelKey ? t(customerDisplayBadge(customerDisplayState(c)!).labelKey) : customerDisplayState(c)!" /><SharedStatusBadge v-if="!customerDisplayState(c)" tone="neutral" variant="outline" :label="t('vendor.customers.noSubscription')" /></template>
  <template #plan-cell="{ row: { original: c } }">{{ planOf(c) }}</template>
  <template #services-cell="{ row: { original: c } }">{{ services(c) ?? t('app.notAvailable') }}</template>
  <template #branches-cell="{ row: { original: c } }">{{ branches(c) ?? t('app.notAvailable') }}</template>
  <template #renewal-cell="{ row: { original: c } }"><bdi dir="ltr">{{ c.subscription?.renewal_at ?? t('app.notAvailable') }}</bdi></template>
  <template #mobile-row="{ row: c }"><div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0"><h2 class="text-lg font-semibold"><NuxtLink data-testid="customer-row" :to="to(c)">{{ c.name }}</NuxtLink></h2></div>
            <div class="flex flex-wrap items-center gap-2">
              <SharedStatusBadge v-if="c.commercial_setup_required" tone="warning" :label="t('vendor.customers.setupRequired')" data-testid="setup-required" />
              <SharedStatusBadge v-if="customerDisplayState(c)" :tone="customerDisplayBadge(customerDisplayState(c)!).tone" :label="t(`vendor.customers.display.${customerDisplayState(c)}`)" />
              <SharedStatusBadge v-else tone="neutral" variant="outline" :label="t('vendor.customers.noSubscription')" />
            </div>
          </div>
          <dl v-if="c.subscription" class="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt class="text-muted">{{ t('vendor.customers.plan') }}</dt><dd>{{ planOf(c) }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.customers.services') }}</dt><dd class="tabular-nums">{{ services(c) ?? t('app.notAvailable') }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.customers.branches') }}</dt><dd class="tabular-nums">{{ branches(c) ?? t('app.notAvailable') }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.customers.renewal') }}</dt><dd class="tabular-nums"><bdi dir="ltr">{{ c.subscription.renewal_at ?? t('app.notAvailable') }}</bdi></dd></div>
          </dl>
          <p v-else-if="c.commercial_setup_required" class="mt-3 text-sm text-muted">{{ t('vendor.customers.setupHint') }}</p></template>
</SharedDataTable>
</SharedListPage>
</template>
