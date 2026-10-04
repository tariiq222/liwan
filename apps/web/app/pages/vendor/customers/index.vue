<script setup lang="ts">
import { useVendorCommercial } from '@/composables/useVendorCommercial'
import { CUSTOMER_STATE_FILTERS, customerDisplayState, customerListQuery, displayStateColor, isCustomerStateFilter, isNotAvailable, type VendorCustomer } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
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
const services = (c: VendorCustomer) => c.subscription?.applied?.entitlement.modules.length ?? null
const branches = (c: VendorCustomer) => (c.subscription?.applied ? 1 + c.subscription.applied.extra_branch_count : null)
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('vendor.customers.title')" :description="t('vendor.customers.description')" />
    <SharedFilterBar :active-count="Number(Boolean(q)) + Number(state !== 'all')" @clear="router.replace('/vendor/customers')">
      <template #search><UInput :model-value="q" :aria-label="t('vendor.customers.search')" :placeholder="t('vendor.customers.search')" icon="i-lucide-search" :disabled="!hydrated" @update:model-value="patch({ q: $event || undefined })" /></template>
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="state" :items="stateItems" :disabled="!hydrated" @update:model-value="patch({ state: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="q" :label="q" @remove="patch({ q: undefined })" /><SharedFilterChip v-if="state !== 'all'" :label="t(`vendor.customers.filter.${state}`)" @remove="patch({ state: undefined })" /></template>
    </SharedFilterBar>
    <UAlert v-if="unavailable" color="neutral" variant="subtle" icon="i-lucide-clock" :title="t('vendor.customers.notAvailable')" :description="t('vendor.customers.notAvailableHint')" />
    <SharedPageState v-else :loading="pending" :error="error" :empty="!pending && !error && !items.length" :empty-text="t(q || state !== 'all' ? 'vendor.customers.noResults' : 'vendor.customers.empty')" @retry="refresh">
      <div class="space-y-4">
        <UCard v-for="c in items" :key="c.id" data-testid="customer-row">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0"><h2 class="text-lg font-semibold"><NuxtLink :to="to(c)">{{ c.name }}</NuxtLink></h2></div>
            <div class="flex flex-wrap items-center gap-2">
              <UBadge v-if="c.commercial_setup_required" color="warning" variant="subtle" data-testid="setup-required">{{ t('vendor.customers.setupRequired') }}</UBadge>
              <UBadge v-if="customerDisplayState(c)" :color="displayStateColor(customerDisplayState(c)!)" variant="subtle">{{ t(`vendor.customers.display.${customerDisplayState(c)}`) }}</UBadge>
              <UBadge v-else color="neutral" variant="outline">{{ t('vendor.customers.noSubscription') }}</UBadge>
            </div>
          </div>
          <dl v-if="c.subscription" class="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt class="text-muted">{{ t('vendor.customers.plan') }}</dt><dd>{{ planOf(c) }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.customers.services') }}</dt><dd class="tabular-nums">{{ services(c) ?? t('app.notAvailable') }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.customers.branches') }}</dt><dd class="tabular-nums">{{ branches(c) ?? t('app.notAvailable') }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.customers.renewal') }}</dt><dd class="tabular-nums"><bdi dir="ltr">{{ c.subscription.renewal_at ?? t('app.notAvailable') }}</bdi></dd></div>
          </dl>
          <p v-else-if="c.commercial_setup_required" class="mt-3 text-sm text-muted">{{ t('vendor.customers.setupHint') }}</p>
        </UCard>
      </div>
      <div v-if="data" class="mt-4 grid gap-3"><p class="text-sm text-muted">{{ t('vendor.pagination.total', { count: data.total }) }}</p><SharedPagination :page="page" :pages="pages" @update:page="value => patch({ page: value })" /></div>
    </SharedPageState>
  </SharedPageContainer>
</template>
