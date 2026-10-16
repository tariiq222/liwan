<script setup lang="ts">
import { TENANT_TABS, clientTab, clientTabItems } from '@/utils/vendorClients'
import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
definePageMeta({ capability: 'vendor.read', middleware: 'tenant-customer' })
const { t } = useI18n()
const route = useRoute()
const id = computed(() => String(route.params.id))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/customers', ['/customers']))
const { data, error, pending, refresh } = await useVendorTenant(id)
const tab = computed(() => clientTab(route.query.tab, TENANT_TABS))
const tabs = computed(() => clientTabItems(TENANT_TABS, tab.value, route, key => t(`vendor.clientTabs.${key}`), 'tenant-tab'))
const operationsDirty = ref(false)
const progress = useWorkspaceProvisioning(id, () => tab.value !== 'operations')
</script>

<template>
  <SharedUnsavedChanges :dirty="operationsDirty" guard-route-updates />
  <SharedRecordPage :title="data?.name ?? t('vendor.tenants.details')" :back-to="backTo" :loading="pending" :error="error" @retry="refresh">
    <template #tabs><SharedRouteTabs :items="tabs" :ariaLabel="t('vendor.clientTabs.label')" /></template>
    <template v-if="data">
      <VendorTenantProperties v-if="tab === 'summary'" :tenant="data" :progress="progress" />
      <VendorWorkspacePanel v-else-if="tab === 'workspace'" :tenant="data" :progress="progress" />
      <VendorTenantOperationsPanel v-else v-model:dirty="operationsDirty" :tenant-id="id" />
    </template>
  </SharedRecordPage>
</template>
