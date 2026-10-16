<script setup lang="ts">
const props = defineProps<{ tenantId: string }>()
const { t } = useI18n()
const hydrated = useHydrated()
const tenantId = toRef(props, 'tenantId')
const { data: tenant, error: tenantError, pending: tenantPending, refresh: refreshTenant } = useVendorTenant(tenantId)
const { provisioning, error: provisioningError, pending: provisioningPending, loginUrl, failed: provisioningFailed, stage: provisioningStage, pollingPaused: provisioningPollingPaused, refreshNow } = useWorkspaceProvisioning(tenantId)
</script>

<template>
  <SharedPageState :loading="tenantPending && !tenant" :error="tenantError" @retry="refreshTenant">
  <div class="space-y-6">
    <SharedRecordSection panel :title="t('vendor.tenants.provisioning.title')">
      <template #actions>
        <UButton v-if="loginUrl" :to="loginUrl" external target="_blank" rel="noopener noreferrer" size="sm" icon="i-lucide-external-link">{{ t('vendor.tenants.provisioning.open') }}</UButton>
        <UButton v-if="provisioning || provisioningError" color="neutral" variant="outline" size="sm" icon="i-lucide-refresh-cw" :disabled="!hydrated || provisioningPending" :loading="provisioningPending" @click="refreshNow">{{ t('vendor.common.refresh') }}</UButton>
      </template>
      <div aria-live="polite" class="grid gap-4">
        <UAlert v-if="provisioningError" color="error" variant="subtle" :title="t('vendor.tenants.provisioning.unavailable')" />
        <UAlert v-else-if="provisioningFailed" color="error" variant="subtle" :title="t('vendor.tenants.provisioning.failed')" :description="t('vendor.tenants.provisioning.failedHint')" />
        <VendorProvisioningSteps v-if="provisioning" :stage="provisioningStage" :failed="provisioningFailed" />
        <SharedEmptyState v-else-if="!provisioningError" :title="t('vendor.tenants.provisioning.none')" :description="t('vendor.tenants.provisioning.noneHint')" />
        <p v-if="provisioning?.admin_login" class="text-sm"><span class="text-muted">{{ t('vendor.tenants.fields.adminLogin') }}: </span><bdi>{{ provisioning.admin_login }}</bdi></p>
        <p v-if="provisioningPollingPaused" class="text-sm text-muted">{{ t('vendor.tenants.provisioning.paused') }}</p>
      </div>
    </SharedRecordSection>

    <SharedRecordSection v-if="tenant" panel :title="t('vendor.tenants.policyTitle')" :description="t('vendor.tenants.policyHint')">
      <VendorPolicyComparison :desired="tenant.desired_policy" :observed="tenant.observed_policy" />
    </SharedRecordSection>
  </div>
  </SharedPageState>
</template>
