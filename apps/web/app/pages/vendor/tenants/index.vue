<script setup lang="ts">
import FilterBar from '@/components/shared/FilterBar.vue'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
type Tenant = { id: string; name: string; commercial_mode: string; hosting_model: string; status: string; inventory_target: string; catalog_version: string | null; operations_enabled: boolean; created_at: string }
const { t } = useI18n(); const route = useRoute(); const router = useRouter(); const { request } = useVendorApi(); const { can } = useVendorContext()
const q = computed({ get: () => typeof route.query.q === 'string' ? route.query.q : '', set: value => router.replace({ query: { ...route.query, q: value || undefined, page: undefined } }) })
const mode = computed({ get: () => typeof route.query.mode === 'string' ? route.query.mode : '', set: value => router.replace({ query: { ...route.query, mode: value || undefined, page: undefined } }) })
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1))
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 25)))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:tenants:${q.value}:${route.query.mode ?? ''}:${route.query.page ?? '1'}`, () => request<{ items: Tenant[]; total: number }>('tenants', { query: { q: q.value || undefined, mode: route.query.mode, page: route.query.page } }))
const items = computed(() => data.value?.items ?? [])
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('vendor.tenants.title')"><template #actions><UButton v-if="can('vendor.tenants.manage')" :to="{ path: '/vendor/tenants/new', query: { returnTo: route.fullPath } }" icon="i-lucide-plus">{{ t('vendor.tenants.new') }}</UButton></template></SharedPageHeader>
    <FilterBar :active-count="Number(Boolean(q)) + Number(Boolean(mode))" @clear="{ q = ''; mode = '' }"><template #search><UInput v-model="q" icon="i-lucide-search" :placeholder="t('vendor.tenants.search')" :aria-label="t('vendor.tenants.search')" /></template><UFormField :label="t('vendor.tenants.fields.mode')"><USelect :model-value="mode || '__all__'" @update:model-value="mode = $event === '__all__' ? '' : String($event)" :items="[{ label: t('vendor.common.allModes'), value: '__all__' }, { label: t('vendor.mode.saas'), value: 'saas' }, { label: t('vendor.mode.nonSaas'), value: 'non_saas' }]" /></UFormField></FilterBar>
    <SharedPageState :loading="pending" :error="error" :empty="!pending && !error && items.length === 0" :empty-text="t('vendor.tenants.empty')" @retry="refresh">
      <div class="grid gap-3">
        <NuxtLink v-for="tenant in items" :key="tenant.id" :to="{ path: `/vendor/tenants/${tenant.id}`, query: { returnTo: route.fullPath } }" class="block rounded-lg bg-default p-4 ring ring-default hover:bg-elevated focus-visible:outline-primary">
          <div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="font-semibold">{{ tenant.name }}</h2><p class="mt-1 text-sm text-muted">{{ t(`vendor.mode.${tenant.commercial_mode === 'saas' ? 'saas' : 'nonSaas'}`) }} · {{ t(`vendor.hosting.${tenant.hosting_model === 'managed' ? 'managed' : 'customerHosted'}`) }}</p></div><UBadge color="neutral" variant="subtle">{{ t(`vendor.status.${tenant.status}`) }}</UBadge></div>
          <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted"><span>{{ t('vendor.tenants.target') }}: <bdi>{{ tenant.inventory_target }}</bdi></span><span>{{ t('vendor.tenants.operations') }}: {{ tenant.operations_enabled ? t('vendor.common.yes') : t('vendor.common.no') }}</span></div>
        </NuxtLink>
      </div>
      <div v-if="data" class="mt-4 grid gap-3"><p class="text-sm text-muted">{{ t('vendor.pagination.total', { count: data.total }) }}</p><SharedPagination :page="page" :pages="pages" @update:page="value => router.replace({ query: { ...route.query, page: value } })" /></div>
    </SharedPageState>
  </SharedPageContainer>
</template>
