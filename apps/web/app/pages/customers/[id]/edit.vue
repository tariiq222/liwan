<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import CustomerForm from '@/components/customers/CustomerForm.vue'
import { useCustomerSettings } from '@/composables/customers/useCustomerSettings'
import { useCustomer } from '@/composables/customers/useCustomers'

const route = useRoute()
const sourcePaths = useRecordListPaths(['/customers'])
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.id))
const query = useCustomer(id)
const settings = useCustomerSettings()
const customer = computed(() => query.data.value)
const canManage = computed(() => can('customers.manage'))
// Child pages always return to their current record; the list's referrer is carried as listOrigin.
const backTo = computed(() => recordParentTo(`/customers/${id.value}`, {
  ...route.query, listOrigin: route.query.listOrigin ?? route.query.returnTo ?? null,
}, sourcePaths.value, route.hash))
// DESIGN.md section 5: a saved form is not sent again through Back, so the record replaces the editor in the history.
function saved() { void navigateTo(backTo.value, { replace: true }) }
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('customers.edit')" :back-to="backTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value || settings.isLoading.value" :error="query.error.value ?? settings.error.value" :empty="!customer || !settings.data.value" @retry="() => { query.refetch(); settings.refetch() }">
      <CustomerForm v-if="customer && settings.data.value" :customer="customer" :settings="settings.data.value" :back-to="backTo" @saved="saved" />
    </SharedPageState>
  </SharedPageContainer>
</template>
