<script setup lang="ts">
import { formatLiwanDate } from '@liwan/ui/app/composables/calendarDate'
import { lifecycleBadge } from '@/utils/vendorCommercial'
import { packageLabel } from '@/utils/vendorPackages'
import { sellableTiers } from '@/utils/vendorCatalogVersions'
import { useVendorCatalogVersions } from '@/composables/useVendorCatalogVersions'
definePageMeta({ capability: 'vendor.read' })
const { t } = useI18n(); const route = useRoute()
const id = computed(() => String(route.params.id))
// The control plane has no single-entry read: the list is loaded and the entry found in it.
const { data: versions, error: loadError, pending, refresh } = await useVendorCatalogVersions().load()
const version = computed(() => versions.value?.find(item => item.id === id.value))
const error = computed(() => loadError.value ?? (versions.value && !version.value ? createError({ statusCode: 404, statusMessage: 'not_found' }) : null))
const tiers = computed(() => version.value?.solution.tiers ?? [])
const sellableCount = computed(() => (version.value ? sellableTiers(version.value).length : 0))
const baseModules = computed(() => version.value?.solution.base_modules ?? [])
</script>
<template>
  <SharedRecordPage :title="version?.version ?? t('vendor.catalog.details')" back-to="/catalog" :back-label="t('vendor.catalog.applications')" :loading="pending" :error="error" @retry="refresh">
    <template v-if="version">
      <VendorCatalogFacts :facts="[{ key: 'sellable', label: t('vendor.catalog.sellableApps'), value: sellableCount }, { key: 'imported', label: t('vendor.catalog.imported'), value: formatLiwanDate(version.created_at) }]" class="mt-6">
        <template #status><SharedStatusBadge data-slot="lifecycle-badge" :tone="lifecycleBadge(version).tone" :label="t(lifecycleBadge(version).labelKey)" /></template>
      </VendorCatalogFacts>
      <SharedRecordSection :title="t('vendor.catalog.appsTitle')" class="mt-6" data-testid="catalog-apps">
        <p v-if="!tiers.length" class="text-sm text-muted">{{ t('vendor.catalog.noApps') }}</p>
        <ul v-else class="space-y-3">
          <li v-for="tier in tiers" :key="tier.id" class="rounded-control p-3 ring ring-default" data-testid="catalog-app">
            <p class="flex flex-wrap items-center gap-2 font-medium">{{ tier.name }}<UBadge v-if="tier.sellable === true && tier.id !== 'core'" color="success" variant="subtle" data-testid="catalog-sellable">{{ t('vendor.catalog.sellable') }}</UBadge></p>
            <p v-if="tier.description" class="mt-1 text-sm text-muted">{{ tier.description }}</p>
            <div v-if="tier.features?.length" class="mt-2 flex flex-wrap gap-2"><UBadge v-for="feature in tier.features" :key="feature" color="neutral" variant="subtle">{{ packageLabel('feature', feature, t) }}</UBadge></div>
          </li>
        </ul>
      </SharedRecordSection>
      <VendorCatalogVersionAction class="mt-6" :version="version" @done="refresh" />
      <UAlert v-if="version.status === 'published'" class="mt-6" color="success" variant="subtle" :title="t('vendor.catalog.publishedTitle')" data-testid="catalog-next-step">
        <template #description><NuxtLink to="/bundles/new" class="font-medium text-primary hover:underline">{{ t('vendor.catalog.toBundles') }}</NuxtLink></template>
      </UAlert>
      <details class="mt-6"><summary class="cursor-pointer text-sm text-muted">{{ t('vendor.pricing.technical') }}</summary>
        <dl class="mt-3 space-y-2 text-sm"><div><dt>{{ t('vendor.catalog.baseModules') }}</dt><dd class="flex flex-wrap gap-2"><UBadge v-for="module in baseModules" :key="module" color="neutral" variant="outline">{{ packageLabel('module', module, t) }}</UBadge></dd></div><div><dt>{{ t('vendor.pricing.revisionId') }}</dt><dd dir="ltr">{{ version.id }}</dd></div></dl>
      </details>
    </template>
  </SharedRecordPage>
</template>
