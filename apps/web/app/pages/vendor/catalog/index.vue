<script setup lang="ts">
import type { PackageRevision } from '@nasq/commercial-contracts'
import { packageLabel, packageListReturnTo, packageMatchesStatus } from '@/utils/vendorPackages'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t } = useI18n(); const route = useRoute(); const router = useRouter(); const { request } = useVendorApi(); const { can } = useVendorContext(); const hydrated = useHydrated()
const { data, error, pending, refresh } = await useAsyncData('vendor:packages', () => request<{ items: PackageRevision[]; total: number }>('packages'))
const listQuery = computed(() => route.query)
const search = computed(() => typeof listQuery.value.q === 'string' ? listQuery.value.q : '')
const status = computed(() => typeof listQuery.value.status === 'string' ? listQuery.value.status : '')
const listTo = computed(() => packageListReturnTo(route.fullPath))
function filter(key: string, value: unknown) { void router.replace({ path: '/vendor/catalog', query: { ...listQuery.value, [key]: typeof value === 'string' && value ? value : undefined } }) }
const items = computed(() => (data.value?.items ?? []).filter(item => (!search.value || `${item.name} ${item.description}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())) && packageMatchesStatus(item, status.value)))
const statusOptions = computed(() => ['', 'draft', 'validated', 'published', 'unavailable'].map(value => ({ value, label: t(`vendor.packages.status.${value || 'all'}`) })))
const path = (id: string) => ({ path: `/vendor/catalog/${encodeURIComponent(id)}`, query: { returnTo: listTo.value } })
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('vendor.packages.title')" :description="t('vendor.packages.description')"><template #actions><UButton to="/vendor/plans" color="neutral" variant="outline" icon="i-lucide-badge-percent">{{ t('vendor.plans.title') }}</UButton></template></SharedPageHeader>
    <UAlert class="mb-4" color="neutral" variant="subtle" :title="t('vendor.packages.retired')" :description="t('vendor.packages.retiredHint')" />
    <SharedFilterBar :active-count="Number(Boolean(search)) + Number(Boolean(status))" @clear="router.replace('/vendor/catalog')">
      <template #search><UInput :model-value="search" :aria-label="t('vendor.packages.search')" :placeholder="t('vendor.packages.search')" icon="i-lucide-search" :disabled="!hydrated" @update:model-value="filter('q', $event)" /></template>
      <SharedFilterChoice :label="t('vendor.common.status')" :model-value="status" :items="statusOptions" :disabled="!hydrated" @update:model-value="filter('status', $event)" />
      <template #active><SharedFilterChip v-if="search" :label="search" @remove="filter('q', '')" /><SharedFilterChip v-if="status" :label="t(`vendor.packages.status.${status}`)" @remove="filter('status', '')" /></template>
    </SharedFilterBar>
    <SharedPageState :loading="pending" :error="error" :empty="!pending && !error && !items.length" :empty-text="t(data?.items.length ? 'vendor.packages.noResults' : 'vendor.packages.empty')" @retry="refresh">
      <div class="space-y-4"><UCard v-for="item in items" :key="item.id">
        <div class="flex flex-wrap items-start justify-between gap-4"><div class="min-w-0"><h2 class="text-lg font-semibold"><NuxtLink :to="path(item.id)">{{ item.name }}</NuxtLink></h2><p class="mt-1 text-sm text-muted">{{ item.description }}</p></div><UBadge color="neutral" variant="subtle">{{ t(`vendor.packages.status.${item.status === 'published' && !item.available ? 'unavailable' : item.status}`) }} · {{ t('vendor.packages.version', { count: item.version }) }}</UBadge></div>
        <div class="mt-4 flex flex-wrap gap-2"><UBadge color="neutral" variant="subtle">{{ packageLabel('tier', item.catalog_tier, t) }}</UBadge><UBadge v-for="feature in item.features.filter(value => value.startsWith('boolean:'))" :key="feature" color="neutral" variant="outline">{{ packageLabel('feature', feature, t) }}</UBadge></div>
        <dl class="mt-4 grid gap-3 sm:grid-cols-3"><div v-for="(value, key) in item.limits" :key="key"><dt class="text-xs text-muted">{{ packageLabel('limit', key, t) }}</dt><dd class="font-medium">{{ value === null ? t('vendor.common.unlimited') : value }}<span v-if="value === 0" class="ms-1 text-sm text-warning">{{ t('vendor.packages.noUsage') }}</span></dd></div></dl>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-2"><p class="text-sm text-muted">{{ t('vendor.packages.customers', { count: item.customer_count }) }}</p><UButton :to="path(item.id)" color="neutral" variant="link">{{ t('vendor.packages.details') }}</UButton></div>
      </UCard></div>
    </SharedPageState>
  </SharedPageContainer>
</template>
