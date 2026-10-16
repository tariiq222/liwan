<script setup lang="ts">
import { operationStatusBadge } from '@/utils/vendorBadges'
import { formatNasqDateTime } from '@nasq/ui/app/composables/calendarDate'
import type { VendorTenant } from '@/utils/vendorTenant'
import type { WorkspaceProvisioning } from '@/composables/useWorkspaceProvisioning'
// The tenant and its provisioning progress come from the page that owns them (one load, one error block, one poll).
defineProps<{ tenant: VendorTenant; progress: WorkspaceProvisioning; hideOpen?: boolean }>()
const { t, locale } = useI18n()
</script>

<template>
  <div class="space-y-3">
    <SharedPropertiesPanel :title="t('vendor.tenants.workspaceDetails')">
      <SharedPropertyRow :label="t('vendor.common.status')"><SharedStatusBadge :tone="operationStatusBadge(progress.provisioning?.status ?? tenant.status).tone" :label="t(operationStatusBadge(progress.provisioning?.status ?? tenant.status).labelKey)" /></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.tenants.fields.mode')" :value="t(`vendor.mode.${tenant.commercial_mode === 'saas' ? 'saas' : 'nonSaas'}`)" />
      <SharedPropertyRow :label="t('vendor.tenants.fields.hosting')" :value="t(`vendor.hosting.${tenant.hosting_model === 'managed' ? 'managed' : 'customerHosted'}`)" />
      <SharedPropertyRow v-if="!progress.provisioning" :label="t('vendor.tenants.target')"><bdi>{{ tenant.inventory_target }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.tenants.fields.catalogVersion')">{{ tenant.catalog_version || t('vendor.common.none') }}<span v-if="tenant.catalog_tier"> · {{ t(`vendor.catalog.tiers.${tenant.catalog_tier}`, tenant.catalog_tier) }}</span></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.tenants.operations')" :value="tenant.operations_enabled ? t('vendor.common.enabled') : t('vendor.common.disabled')" />
      <SharedPropertyRow :label="t('vendor.tenants.healthChecked')" :value="tenant.health_checked_at ? formatNasqDateTime(tenant.health_checked_at, locale) : null" />
    </SharedPropertiesPanel>
    <UButton v-if="progress.loginUrl && !hideOpen" :to="progress.loginUrl" external target="_blank" rel="noopener noreferrer" icon="i-lucide-external-link">{{ t('vendor.tenants.provisioning.open') }}</UButton>
  </div>
</template>
