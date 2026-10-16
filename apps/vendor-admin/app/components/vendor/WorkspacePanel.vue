<script setup lang="ts">
import type { VendorTenant } from '@/utils/vendorTenant'
import type { WorkspaceProvisioning } from '@/composables/useWorkspaceProvisioning'
// The tenant and its provisioning progress come from the page that owns them (one load, one error block, one poll).
defineProps<{ tenant: VendorTenant; progress: WorkspaceProvisioning }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { sharedOnboardingEnabled } = useVendorContext()
</script>

<template>
  <div class="space-y-6">
    <SharedRecordSection v-if="sharedOnboardingEnabled" panel :title="t('vendor.tenants.provisioning.title')">
      <template #actions>
        <UButton v-if="progress.loginUrl" :to="progress.loginUrl" external target="_blank" rel="noopener noreferrer" size="sm" icon="i-lucide-external-link">{{ t('vendor.tenants.provisioning.open') }}</UButton>
        <UButton v-if="progress.provisioning || progress.error" color="neutral" variant="outline" size="sm" icon="i-lucide-refresh-cw" :disabled="!hydrated || progress.pending" :loading="progress.pending" @click="progress.refreshNow">{{ t('vendor.common.refresh') }}</UButton>
      </template>
      <div aria-live="polite" class="grid gap-4">
        <UAlert v-if="progress.error" color="error" variant="subtle" :title="t('vendor.tenants.provisioning.unavailable')" />
        <UAlert v-else-if="progress.failed" color="error" variant="subtle" :title="t('vendor.tenants.provisioning.failed')" :description="t('vendor.tenants.provisioning.failedHint')" />
        <VendorProvisioningSteps v-if="progress.provisioning" :stage="progress.stage" :failed="progress.failed" />
        <SharedEmptyState v-else-if="!progress.error" :title="t('vendor.tenants.provisioning.none')" :description="t('vendor.tenants.provisioning.noneHint')" />
        <p v-if="progress.provisioning?.admin_login" class="text-sm"><span class="text-muted">{{ t('vendor.tenants.fields.adminLogin') }}: </span><bdi>{{ progress.provisioning.admin_login }}</bdi></p>
        <p v-if="progress.pollingPaused" class="text-sm text-muted">{{ t('vendor.tenants.provisioning.paused') }}</p>
      </div>
    </SharedRecordSection>

    <SharedRecordSection panel :title="t('vendor.tenants.policyTitle')" :description="t('vendor.tenants.policyHint')">
      <VendorPolicyComparison :desired="tenant.desired_policy" :observed="tenant.observed_policy" />
    </SharedRecordSection>
  </div>
</template>
