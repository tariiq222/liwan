<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { operationStatusBadge } from '@/utils/vendorBadges'
definePageMeta({ capability: 'vendor.read' })
type Tenant = { id: string; name: string; commercial_mode: string; hosting_model: string; status: string; inventory_target: string; catalog_version: string | null; operations_enabled: boolean; created_at: string }
const { t } = useI18n(); const route = useRoute(); const router = useRouter(); const hydrated = useHydrated(); const { request } = useVendorApi(); const { can } = useVendorContext()
const MODES = ['all', 'saas', 'non_saas'] as const
const q = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))
const mode = computed(() => MODES.find(value => value === route.query.mode) ?? 'all')
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1))
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 25)))
function patch(change: Record<string, unknown>) { void router.replace({ path: '/tenants', query: { ...route.query, page: undefined, ...change } }) }
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:tenants:${q.value}:${mode.value}:${page.value}`, () => request<{ items: Tenant[]; total: number }>('tenants', { query: { q: q.value || undefined, mode: mode.value === 'all' ? undefined : mode.value, page: page.value > 1 ? page.value : undefined } }), { watch: [q, mode, page] })
const modeLabel = (value: string) => (value === 'all' ? t('vendor.common.allModes') : t(`vendor.mode.${value === 'saas' ? 'saas' : 'nonSaas'}`))
const modeItems = computed(() => MODES.map(value => ({ value, label: modeLabel(value) })))
const items = computed(() => data.value?.items ?? [])

const tenantTo = (tenant: Tenant) => ({ path: `/tenants/${tenant.id}`, query: { returnTo: route.fullPath } })

const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'name', header: t('vendor.tenants.fields.name') },
  { id: 'mode', header: t('vendor.tenants.fields.mode') },
  { id: 'hosting', header: t('vendor.tenants.fields.hosting') },
  { id: 'status', header: t('vendor.common.status') },
  { id: 'target', header: t('vendor.tenants.target') },
  { id: 'operations', header: t('vendor.tenants.operations') },
  { id: 'catalog', header: t('vendor.tenants.fields.catalogVersion') },
])
</script>
<template>
<SharedListPage :title="t('vendor.tenants.title')" :create-to="can('vendor.tenants.manage') ? { path: '/tenants/new', query: { returnTo: route.fullPath } } : undefined" :create-label="t('vendor.tenants.new')" create-test-id="vendor-tenant-new">

<template #filters><SharedFilterBar :active-count="Number(Boolean(q)) + Number(mode !== 'all')" @clear="router.replace('/tenants')">
      <template #search><UInput :model-value="q" :aria-label="t('vendor.tenants.search')" :placeholder="t('vendor.tenants.search')" icon="i-lucide-search" :disabled="!hydrated" @update:model-value="patch({ q: $event || undefined })" /></template>
      <SharedFilterChoice :label="t('vendor.tenants.fields.mode')" :model-value="mode" :items="modeItems" :disabled="!hydrated" @update:model-value="patch({ mode: $event && $event !== 'all' ? $event : undefined })" />
      <template #active><SharedFilterChip v-if="q" :label="q" @remove="patch({ q: undefined })" /><SharedFilterChip v-if="mode !== 'all'" :label="modeLabel(mode)" @remove="patch({ mode: undefined })" /></template>
    </SharedFilterBar></template>
<p v-if="data" class="text-sm text-muted" data-testid="tenants-result-count">{{ t('vendor.pagination.total', { count: data.total }, data.total) }}</p>

<SharedDataTable  :rows="items" :columns="columns" row-key="id" :row-to="tenantTo" :loading="pending" :error="error" :empty-text="t(q || mode !== 'all' ? 'vendor.tenants.noResults' : 'vendor.tenants.empty')" :caption="t('vendor.tenants.title')" @retry="refresh" :page="page" :pages="pages" @update:page="value => patch({ page: value })">
  <template #name-cell="{ row: { original: tenant } }"><NuxtLink :to="tenantTo(tenant)" class="font-medium hover:underline">{{ tenant.name }}</NuxtLink></template>
  <template #mode-cell="{ row: { original: tenant } }">{{ t(`vendor.mode.${tenant.commercial_mode === 'saas' ? 'saas' : 'nonSaas'}`) }}</template>
  <template #hosting-cell="{ row: { original: tenant } }">{{ t(`vendor.hosting.${tenant.hosting_model === 'managed' ? 'managed' : 'customerHosted'}`) }}</template>
  <template #status-cell="{ row: { original: tenant } }"><SharedStatusBadge  :tone="operationStatusBadge(tenant.status).tone" :label="operationStatusBadge(tenant.status).labelKey ? t(operationStatusBadge(tenant.status).labelKey) : tenant.status" /></template>
  <template #target-cell="{ row: { original: tenant } }"><bdi>{{ tenant.inventory_target }}</bdi></template>
  <template #operations-cell="{ row: { original: tenant } }">{{ tenant.operations_enabled ? t('vendor.common.yes') : t('vendor.common.no') }}</template>
  <template #catalog-cell="{ row: { original: tenant } }">{{ tenant.catalog_version ?? t('vendor.common.none') }}</template>
  <template #mobile-row="{ row: tenant }"><div class="flex flex-wrap items-start justify-between gap-3"><div><NuxtLink :to="tenantTo(tenant)" class="font-semibold">{{ tenant.name }}</NuxtLink><p class="mt-1 text-sm text-muted">{{ t(`vendor.mode.${tenant.commercial_mode === 'saas' ? 'saas' : 'nonSaas'}`) }} · {{ t(`vendor.hosting.${tenant.hosting_model === 'managed' ? 'managed' : 'customerHosted'}`) }}</p></div><SharedStatusBadge  :tone="operationStatusBadge(tenant.status).tone" :label="operationStatusBadge(tenant.status).labelKey ? t(operationStatusBadge(tenant.status).labelKey) : tenant.status" /></div>
          <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted"><span>{{ t('vendor.tenants.target') }}: <bdi>{{ tenant.inventory_target }}</bdi></span><span>{{ t('vendor.tenants.operations') }}: {{ tenant.operations_enabled ? t('vendor.common.yes') : t('vendor.common.no') }}</span></div></template>
</SharedDataTable>
</SharedListPage>
</template>
