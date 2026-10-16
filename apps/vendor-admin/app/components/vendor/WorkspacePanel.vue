<script setup lang="ts">
const props = defineProps<{ tenantId: string }>()
const { t } = useI18n()
const hydrated = useHydrated()
const tenantId = toRef(props, 'tenantId')
const { data: tenant, error: tenantError, pending: tenantPending, refresh: refreshTenant } = useVendorTenant(tenantId)
const { provisioning, error: provisioningError, pending: provisioningPending, loginUrl, failed: provisioningFailed, stage: provisioningStage, pollingPaused: provisioningPollingPaused, refreshNow } = useWorkspaceProvisioning(tenantId)
function policyValue(value: unknown): string {
  if (value === null) return t('vendor.common.unlimited')
  if (typeof value === 'boolean') return t(value ? 'vendor.common.enabled' : 'vendor.common.disabled')
  return String(value)
}
</script>

<template>
  <SharedPageState :loading="tenantPending && !tenant" :error="tenantError" @retry="refreshTenant">
  <div class="space-y-6">
    <SharedRecordSection v-if="provisioning || provisioningError" :title="t('vendor.tenants.provisioning.title')">
      <div aria-live="polite" class="grid gap-3">
        <UAlert v-if="provisioningError" color="error" variant="subtle" :title="t('vendor.tenants.provisioning.unavailable')" />
        <UAlert v-else-if="provisioningFailed" color="error" variant="subtle" :title="t('vendor.tenants.provisioning.failed')" :description="t('vendor.tenants.provisioning.failedHint')" />
        <p v-if="provisioning">{{ t(`vendor.tenants.provisioning.stages.${provisioningStage}`) }}</p>
        <p v-if="provisioning?.admin_login" class="text-sm"><span class="text-muted">{{ t('vendor.tenants.fields.adminLogin') }}: </span><bdi>{{ provisioning.admin_login }}</bdi></p>
        <p v-if="provisioningPollingPaused" class="text-sm text-muted">{{ t('vendor.tenants.provisioning.paused') }}</p>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <UButton v-if="loginUrl" :to="loginUrl" external target="_blank" rel="noopener noreferrer" icon="i-lucide-external-link">{{ t('vendor.tenants.provisioning.open') }}</UButton>
        <UButton color="neutral" variant="outline" :disabled="!hydrated || provisioningPending" :loading="provisioningPending" @click="refreshNow">{{ t('vendor.common.refresh') }}</UButton>
      </div>
    </SharedRecordSection>

    <SharedRecordSection v-if="tenant" :title="t('vendor.tenants.policyTitle')" :description="t('vendor.tenants.policyHint')">
      <div class="grid gap-4 md:grid-cols-2">
        <section><h3 class="mb-2 text-sm font-medium">{{ t('vendor.tenants.desiredPolicy') }}</h3><dl class="grid gap-2 text-sm"><div v-for="[key, value] in Object.entries(tenant.desired_policy ?? {})" :key="key" class="flex justify-between gap-3"><dt>{{ t(`vendor.features.${key}`, key) }}</dt><dd><bdi>{{ policyValue(value) }}</bdi></dd></div><p v-if="!Object.keys(tenant.desired_policy ?? {}).length" class="text-muted">{{ t('vendor.common.none') }}</p></dl></section>
        <section><h3 class="mb-2 text-sm font-medium">{{ t('vendor.tenants.observedPolicy') }}</h3><dl class="grid gap-2 text-sm"><div v-for="[key, value] in Object.entries(tenant.observed_policy ?? {})" :key="key" class="flex justify-between gap-3"><dt>{{ t(`vendor.features.${key}`, key) }}</dt><dd><bdi>{{ policyValue(value) }}</bdi></dd></div><p v-if="!Object.keys(tenant.observed_policy ?? {}).length" class="text-muted">{{ t('vendor.common.none') }}</p></dl></section>
      </div>
    </SharedRecordSection>
  </div>
  </SharedPageState>
</template>
