<script setup lang="ts">
import { operationStatusBadge } from '@/utils/vendorBadges'
import { formatNasqDateTime } from '@nasq/ui/app/composables/calendarDate'
const props = defineProps<{ tenantId: string; hideOpen?: boolean }>()
const { t, locale } = useI18n()
const tenantId = toRef(props, 'tenantId')
const { data: tenant, error: tenantError, pending: tenantPending, refresh: refreshTenant } = useVendorTenant(tenantId)
const { provisioning, loginUrl } = useWorkspaceProvisioning(tenantId)
</script>

<template>
  <SharedPageState :loading="tenantPending && !tenant" :error="tenantError" @retry="refreshTenant">
  <div v-if="tenant" class="space-y-3">
    <SharedPropertiesPanel :title="t('vendor.tenants.workspaceDetails')">
      <SharedPropertyRow :label="t('vendor.common.status')"><SharedStatusBadge :tone="operationStatusBadge(provisioning?.status ?? tenant.status).tone" :label="t(operationStatusBadge(provisioning?.status ?? tenant.status).labelKey)" /></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.tenants.fields.mode')" :value="t(`vendor.mode.${tenant.commercial_mode === 'saas' ? 'saas' : 'nonSaas'}`)" />
      <SharedPropertyRow :label="t('vendor.tenants.fields.hosting')" :value="t(`vendor.hosting.${tenant.hosting_model === 'managed' ? 'managed' : 'customerHosted'}`)" />
      <SharedPropertyRow v-if="!provisioning" :label="t('vendor.tenants.target')"><bdi>{{ tenant.inventory_target }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.tenants.fields.catalogVersion')">{{ tenant.catalog_version || t('vendor.common.none') }}<span v-if="tenant.catalog_tier"> · {{ t(`vendor.catalog.tiers.${tenant.catalog_tier}`, tenant.catalog_tier) }}</span></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.tenants.operations')" :value="tenant.operations_enabled ? t('vendor.common.enabled') : t('vendor.common.disabled')" />
      <SharedPropertyRow :label="t('vendor.tenants.healthChecked')" :value="tenant.health_checked_at ? formatNasqDateTime(tenant.health_checked_at, locale) : null" />
    </SharedPropertiesPanel>
    <UButton v-if="loginUrl && !hideOpen" :to="loginUrl" external target="_blank" rel="noopener noreferrer" icon="i-lucide-external-link">{{ t('vendor.tenants.provisioning.open') }}</UButton>
  </div>
  </SharedPageState>
</template>
