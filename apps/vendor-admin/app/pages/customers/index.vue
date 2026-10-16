<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ClientRow } from '@webvue/commercial-contracts'
import { customerDisplayBadge, operationStatusBadge } from '@/utils/vendorBadges'
import { CLIENT_PAGE_SIZE, CLIENT_STATE_FILTERS, clientListQuery, clientTo, isClientStateFilter } from '@/utils/vendorClients'
import { isNotAvailable } from '@/utils/vendorSubscriptions'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
definePageMeta({ capability: 'vendor.read' })
const { t } = useI18n(); const route = useRoute(); const router = useRouter(); const hydrated = useHydrated(); const api = useVendorSubscriptions(); const { can } = useVendorContext()
const q = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))
const state = computed(() => (isClientStateFilter(route.query.state) ? route.query.state : 'all'))
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1))
function patch(change: Record<string, unknown>) { void router.replace({ path: '/customers', query: { ...route.query, page: undefined, ...change } }) }
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:clients:${q.value}:${state.value}:${page.value}`, () => api.listClients(clientListQuery({ q: q.value, state: state.value, page: page.value })), { watch: [q, state, page] })
const unavailable = computed(() => isNotAvailable(error.value))
const items = computed<ClientRow[]>(() => data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / CLIENT_PAGE_SIZE)))
const stateItems = computed(() => CLIENT_STATE_FILTERS.map(value => ({ value, label: t(`vendor.customers.filter.${value}`) })))
const to = (row: ClientRow) => clientTo(row, route.fullPath)
// A plan bought but not yet applied is shown with its pending state rather than as "no plan".
const planLabel = (row: ClientRow) => row.plan_name ?? (row.pending_plan_name ? t('vendor.customers.pendingPlan', { plan: row.pending_plan_name }) : t('vendor.customers.noPlan'))
const rowKey = (row: ClientRow) => row.customer_id ?? row.tenant_id!
const modeText = (row: ClientRow) => (row.commercial_mode && row.hosting_model ? `${t(`vendor.mode.${row.commercial_mode === 'saas' ? 'saas' : 'nonSaas'}`)} · ${t(`vendor.hosting.${row.hosting_model === 'managed' ? 'managed' : 'customerHosted'}`)}` : null)
const workspaceLabel = (row: ClientRow) => (row.tenant_status ? (operationStatusBadge(row.tenant_status).labelKey ? t(operationStatusBadge(row.tenant_status).labelKey) : row.tenant_status) : '')

const columns = computed<TableColumn<ClientRow>[]>(() => [
  { id: 'name', header: t('vendor.customers.title') },
  { id: 'status', header: t('vendor.common.status') },
  { id: 'plan', header: t('vendor.customers.plan') },
  { id: 'workspace', header: t('vendor.customers.workspace') },
  { id: 'mode', header: t('vendor.customers.modeHosting') },
  { id: 'renewal', header: t('vendor.customers.renewal') },
])
</script>
<template>
<SharedListPage :title="t('vendor.customers.title')" :description="t('vendor.customers.description')" :create-to="can('vendor.tenants.manage') ? { path: '/customers/new', query: { returnTo: route.fullPath } } : undefined" :create-label="t('vendor.customers.new')" create-test-id="vendor-customer-new">

<template #filters><SharedFilterBar :active-count="Number(Boolean(q)) + Number(state !== 'all')" @clear="router.replace('/customers')">
      <template #search><UInput :model-value="q" :aria-label="t('vendor.customers.search')" :placeholder="t('vendor.customers.search')" icon="i-lucide-search" :disabled="!hydrated" @update:model-value="patch({ q: $event || undefined })" /></template>
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="state" :items="stateItems" :disabled="!hydrated" @update:model-value="patch({ state: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="q" :label="q" @remove="patch({ q: undefined })" /><SharedFilterChip v-if="state !== 'all'" :label="t(`vendor.customers.filter.${state}`)" @remove="patch({ state: undefined })" /></template>
    </SharedFilterBar></template>
<p v-if="data" class="text-sm text-muted" data-testid="customers-result-count">{{ t('vendor.pagination.total', { count: data.total }, data.total) }}</p>
<UAlert v-if="unavailable" color="neutral" variant="subtle" icon="i-lucide-clock" :title="t('vendor.customers.notAvailable')" :description="t('vendor.customers.notAvailableHint')" />
<SharedDataTable v-else :rows="items" :columns="columns" :row-key="rowKey" :row-to="to" :loading="pending" :error="error" :empty-text="t(q || state !== 'all' ? 'vendor.customers.noResults' : 'vendor.customers.empty')" :caption="t('vendor.customers.title')" @retry="refresh" :page="page" :pages="pages" @update:page="value => patch({ page: value })">
  <template #name-cell="{ row: { original: c } }"><NuxtLink :to="to(c)" data-testid="customer-row" class="font-medium hover:underline">{{ c.name }}</NuxtLink></template>
  <template #status-cell="{ row: { original: c } }"><SharedStatusBadge v-if="c.setup_required" tone="warning" :label="t('vendor.customers.setupRequired')" data-testid="setup-required" /><SharedStatusBadge v-if="c.subscription_state" :tone="customerDisplayBadge(c.subscription_state).tone" :label="t(customerDisplayBadge(c.subscription_state).labelKey)" /><SharedStatusBadge v-else-if="c.customer_id" tone="neutral" variant="outline" :label="t('vendor.customers.noSubscription')" /><SharedStatusBadge v-else tone="neutral" variant="outline" :label="t('vendor.customers.noCommercial')" data-testid="no-commercial" /></template>
  <template #plan-cell="{ row: { original: c } }">{{ planLabel(c) }}</template>
  <template #workspace-cell="{ row: { original: c } }"><SharedStatusBadge v-if="c.tenant_status" :tone="operationStatusBadge(c.tenant_status).tone" :label="workspaceLabel(c)" /><SharedStatusBadge v-else tone="neutral" variant="outline" :label="t('vendor.customers.noWorkspace')" data-testid="no-workspace" /></template>
  <template #mode-cell="{ row: { original: c } }">{{ modeText(c) ?? t('app.notAvailable') }}</template>
  <template #renewal-cell="{ row: { original: c } }"><bdi dir="ltr">{{ c.renewal_at ?? t('app.notAvailable') }}</bdi></template>
  <template #mobile-row="{ row: c }"><div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0"><h2 class="text-lg font-semibold"><NuxtLink data-testid="customer-row" :to="to(c)">{{ c.name }}</NuxtLink></h2></div>
            <div class="flex flex-wrap items-center gap-2">
              <SharedStatusBadge v-if="c.setup_required" tone="warning" :label="t('vendor.customers.setupRequired')" data-testid="setup-required" />
              <SharedStatusBadge v-if="c.subscription_state" :tone="customerDisplayBadge(c.subscription_state).tone" :label="t(customerDisplayBadge(c.subscription_state).labelKey)" />
              <SharedStatusBadge v-else-if="c.customer_id" tone="neutral" variant="outline" :label="t('vendor.customers.noSubscription')" />
              <SharedStatusBadge v-else tone="neutral" variant="outline" :label="t('vendor.customers.noCommercial')" data-testid="no-commercial" />
            </div>
          </div>
          <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt class="text-muted">{{ t('vendor.customers.plan') }}</dt><dd>{{ planLabel(c) }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.customers.workspace') }}</dt><dd>{{ c.tenant_status ? workspaceLabel(c) : t('vendor.customers.noWorkspace') }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.customers.modeHosting') }}</dt><dd>{{ modeText(c) ?? t('app.notAvailable') }}</dd></div>
            <div><dt class="text-muted">{{ t('vendor.customers.renewal') }}</dt><dd class="tabular-nums"><bdi dir="ltr">{{ c.renewal_at ?? t('app.notAvailable') }}</bdi></dd></div>
          </dl></template>
</SharedDataTable>
</SharedListPage>
</template>
