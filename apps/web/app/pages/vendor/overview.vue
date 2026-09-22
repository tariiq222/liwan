<script setup lang="ts">
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t } = useI18n()
const { request } = useVendorApi()
const { data, error, pending, refresh } = await useAsyncData('vendor:overview', () => request<{ tenants: number; active: number; pending_operations: number; failed_operations: number; last_health_at: string | null }>('overview'))
</script>
<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('vendor.overview.title')" :description="t('vendor.overview.description')" />
    <SharedPageState :loading="pending" :error="error" @retry="refresh">
      <div v-if="data" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SharedMetricTile :label="t('vendor.overview.tenants')" :value="data.tenants" icon="i-lucide-building-2" />
        <SharedMetricTile :label="t('vendor.overview.active')" :value="data.active" icon="i-lucide-circle-check" />
        <SharedMetricTile :label="t('vendor.overview.pending')" :value="data.pending_operations" icon="i-lucide-loader-circle" />
        <SharedMetricTile :label="t('vendor.overview.failed')" :value="data.failed_operations" icon="i-lucide-circle-alert" />
      </div>
      <p v-if="data?.last_health_at" class="mt-4 text-sm text-muted">{{ t('vendor.overview.lastHealth') }}: <time :datetime="data.last_health_at">{{ new Date(data.last_health_at).toLocaleString() }}</time></p>
      <nav class="mt-6 flex flex-wrap gap-3"><UButton to="/vendor/tenants">{{ t('vendor.tenants.title') }}</UButton><UButton to="/vendor/catalog" color="neutral" variant="outline">{{ t('vendor.catalog.title') }}</UButton><UButton to="/vendor/operations" color="neutral" variant="outline">{{ t('vendor.operations.title') }}</UButton></nav>
    </SharedPageState>
  </SharedPageContainer>
</template>
