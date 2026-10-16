<script setup lang="ts">
import { TENANT_TABS, clientTab, clientTabItems } from '@/utils/vendorClients'
import { safeReturnTo } from '@nasq/ui/app/utils/safeReturnTo'
definePageMeta({ capability: 'vendor.read', middleware: 'tenant-customer' })
const { t } = useI18n()
const route = useRoute()
const id = computed(() => String(route.params.id))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/customers', ['/customers']))
const { data, error, pending, refresh } = await useVendorTenant(id)
const tab = computed(() => clientTab(route.query.tab, TENANT_TABS))
const tabs = computed(() => clientTabItems(TENANT_TABS, tab.value, route, key => t(`vendor.clientTabs.${key}`), 'tenant-tab'))
const operationsDirty = ref(false)
</script>

<template>
  <SharedUnsavedChanges :dirty="operationsDirty" guard-route-updates />
  <SharedRecordPage :title="data?.name ?? t('vendor.tenants.details')" :back-to="backTo" :loading="pending" :error="error" @retry="refresh">
    <template #tabs><SharedRouteTabs :items="tabs" :ariaLabel="t('vendor.clientTabs.label')" /></template>
    <VendorTenantProperties v-if="tab === 'summary'" :tenant-id="id" />
    <VendorWorkspacePanel v-else-if="tab === 'workspace'" :tenant-id="id" />
    <VendorTenantOperationsPanel v-else v-model:dirty="operationsDirty" :tenant-id="id" />
  </SharedRecordPage>
</template>
