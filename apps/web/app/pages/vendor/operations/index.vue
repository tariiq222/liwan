<script setup lang="ts">
import type { OperationFeed } from '@nasq/commercial-contracts'
import FilterBar from '@/components/shared/FilterBar.vue'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t } = useI18n(); const route = useRoute(); const router = useRouter(); const { request } = useVendorApi()
const tenantId = computed({ get: () => typeof route.query.tenant_id === 'string' ? route.query.tenant_id : '', set: value => router.replace({ query: { ...route.query, tenant_id: value || undefined } }) })
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1))
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 25)))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:operations:all:${tenantId.value}:${route.query.page ?? '1'}`, () => request<{ items: OperationFeed[]; total: number }>('operations', { query: { source: 'all', tenant_id: tenantId.value || undefined, page: route.query.page } }))
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('vendor.operations.title')" />
    <FilterBar :active-count="tenantId ? 1 : 0" @clear="tenantId = ''">
      <template #search><UInput v-model="tenantId" :aria-label="t('vendor.operations.tenantFilter')" :placeholder="t('vendor.operations.tenantFilter')" /></template>
    </FilterBar>
    <SharedPageState :loading="pending" :error="error" :empty="!pending && !error && !data?.items.length" :empty-text="t('vendor.operations.empty')" @retry="refresh">
      <div class="grid gap-3">
        <NuxtLink v-for="op in data?.items ?? []" :key="`${op.source}:${op.id}`" :to="{ path: `/vendor/operations/${op.id}`, query: { source: op.source, returnTo: route.fullPath } }" class="rounded-lg bg-default p-4 ring ring-default hover:bg-elevated">
          <div class="flex flex-wrap justify-between gap-2"><h2 class="font-medium">{{ t(`vendor.operations.types.${op.type}`, op.type) }}</h2><UBadge color="neutral" variant="subtle">{{ t(`vendor.status.${op.status}`) }}</UBadge></div>
          <p class="mt-1 text-sm text-muted">{{ t('vendor.operations.stage') }}: {{ t(`vendor.operations.stages.${op.stage}`, op.stage) }} · {{ t('vendor.operations.target') }}: <bdi>{{ op.tenant_id }}</bdi></p>
          <p class="mt-1 text-xs text-muted">{{ t(op.source === 'shared' ? (op.last_event_at ? 'vendor.operations.lastEvent' : 'vendor.operations.created') : 'vendor.operations.updated') }}: {{ new Date(op.source === 'shared' ? (op.last_event_at ?? op.created_at) : op.updated_at).toLocaleString() }}</p>
        </NuxtLink>
      </div>
    </SharedPageState>
    <div v-if="data" class="mt-4 grid gap-3"><p class="text-sm text-muted">{{ t('vendor.pagination.total', { count: data.total }) }}</p><SharedPagination :page="page" :pages="pages" @update:page="value => router.replace({ query: { ...route.query, page: value } })" /></div>
  </SharedPageContainer>
</template>
