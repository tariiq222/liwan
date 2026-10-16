<script setup lang="ts">
import type { PackageRevision } from '@webvue/commercial-contracts'
import { packageLabel, packageListReturnTo } from '@/utils/vendorPackages'
definePageMeta({ capability: 'vendor.read' })
const { t } = useI18n(); const route = useRoute(); const { request } = useVendorApi()
const id = computed(() => String(route.params.id)); const backTo = computed(() => packageListReturnTo(route.query.returnTo))
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:package:${id.value}`, () => request<PackageRevision>(`packages/${encodeURIComponent(id.value)}`))
const { data: revisions } = await useAsyncData('vendor:packages', () => request<{ items: PackageRevision[]; total: number }>('packages'))
const history = computed(() => (revisions.value?.items ?? []).filter(item => item.package_id === data.value?.package_id).sort((a, b) => b.version - a.version))
</script>
<template>

    <SharedRecordPage :title="data?.name ?? t('vendor.packages.details')" :description="data?.description" :back-to="backTo" :back-label="t('vendor.packages.title')" :loading="pending" :error="error" @retry="refresh">
    <template v-if="data">

      <SharedRecordSection :title="t('vendor.packages.included')" class="mt-6"><p>{{ packageLabel('tier', data.catalog_tier, t) }}</p><div class="flex flex-wrap gap-2"><UBadge v-for="module in data.modules" :key="module" color="neutral" variant="subtle">{{ packageLabel('module', module, t) }}</UBadge><UBadge v-for="feature in data.features.filter(value => value.startsWith('boolean:'))" :key="feature" color="neutral" variant="outline">{{ packageLabel('feature', feature, t) }}</UBadge></div></SharedRecordSection>
      <SharedRecordSection :title="t('vendor.packages.quotas')" :description="t('vendor.packages.storageHint')" class="mt-6"><dl class="grid gap-4 sm:grid-cols-3"><div v-for="(value, key) in data.limits" :key="key"><dt class="text-sm text-muted">{{ packageLabel('limit', key, t) }}</dt><dd class="font-semibold">{{ value === null ? t('vendor.common.unlimited') : value }}<span v-if="value === 0" class="ms-2 text-warning">{{ t('vendor.packages.noUsage') }}</span></dd></div></dl></SharedRecordSection>
      <SharedRecordSection class="mt-6" :title="t('vendor.packages.history')"><ul class="space-y-2"><li v-for="item in history" :key="item.id"><NuxtLink :to="{ path: `/catalog/${item.id}`, query: { returnTo: backTo } }" class="text-primary">{{ item.name }} · {{ t('vendor.packages.version', { count: item.version }) }}</NuxtLink><span class="ms-2 text-sm text-muted">{{ t(`vendor.packages.status.${item.status === 'published' && !item.available ? 'unavailable' : item.status}`) }}</span></li></ul></SharedRecordSection>
      <details class="mt-6"><summary class="cursor-pointer text-sm text-muted">{{ t('vendor.packages.technical') }}</summary><dl class="mt-3 space-y-2 text-sm"><div><dt>{{ t('vendor.packages.source') }}</dt><dd>{{ data.catalog_version }} · {{ data.catalog_tier }}</dd></div><div><dt>{{ t('vendor.packages.sourceHash') }}</dt><dd class="break-all" dir="ltr">{{ data.source_sha256 }}</dd></div><div><dt>{{ t('vendor.packages.revisionId') }}</dt><dd dir="ltr">{{ data.id }}</dd></div></dl></details>
    </template>
  <template #aside><SharedPropertiesPanel v-if="data"><SharedPropertyRow :label="t('vendor.common.status')"><SharedStatusBadge tone="neutral" :label="t(`vendor.packages.status.${data.status === 'published' && !data.available ? 'unavailable' : data.status}`)" /></SharedPropertyRow><SharedPropertyRow :label="t('vendor.packages.source')" :value="`${data.catalog_version} · ${data.catalog_tier}`" /><SharedPropertyRow :label="t('vendor.packages.version', {count:data.version})" :value="data.version" /><SharedPropertyRow :label="t('vendor.customers.title')" :value="data.customer_count" /></SharedPropertiesPanel></template>
</SharedRecordPage>
</template>
