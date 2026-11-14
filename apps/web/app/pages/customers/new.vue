<script setup lang="ts">
import CustomerDirectory from '@/components/customers/CustomerDirectory.vue'
import CustomerForm from '@/components/customers/CustomerForm.vue'
import { CUSTOMERS_LIST_PATH } from '@/composables/customers/customerListParams'
import { useCustomerSettings } from '@/composables/customers/useCustomerSettings'
import { safeListReturnTo } from '@/composables/useRouteListFilters'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const backTo = computed(() => safeListReturnTo(CUSTOMERS_LIST_PATH, route.query.returnTo))
const settings = useCustomerSettings()
const canManage = computed(() => can('customers.manage'))
function opened(id: number) { void navigateTo({ path: `${CUSTOMERS_LIST_PATH}/${id}`, query: { returnTo: backTo.value } }, { replace: true }) }
</script>

<template>
  <SharedListPage :title="t('customers.title')" hide-header>
    <CustomerDirectory background />
  </SharedListPage>
  <SharedCreatePanel :title="t('customers.new')" :back-to="backTo">
    <SharedForbiddenState v-if="!canManage" />
    <SharedPageState v-else :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" :empty="!settings.data.value" @retry="settings.refetch()">
      <CustomerForm v-if="settings.data.value" :settings="settings.data.value" :back-to="backTo" @saved="customer => opened(customer.id)" @open="opened" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
