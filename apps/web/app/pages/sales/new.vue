<script setup lang="ts">
import SalesOrderDirectory from '@/components/sales/SalesOrderDirectory.vue'
import SalesOrderForm from '@/components/sales/SalesOrderForm.vue'
import { SALES_LIST_PATH, safeSalesReturnTo } from '@/composables/sales/salesListParams'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const backTo = computed(() => safeSalesReturnTo(route.query.returnTo, SALES_LIST_PATH))
function opened(id: number) { void navigateTo({ path: `${SALES_LIST_PATH}/${id}`, query: { returnTo: backTo.value } }, { replace: true }) }
</script>

<template>
  <SharedListPage :title="t('sales.title')" hide-header>
    <SalesOrderDirectory background />
  </SharedListPage>
  <SharedCreatePanel :title="t('sales.new')" :back-to="backTo">
    <SharedForbiddenState v-if="!can('sales.quotations.manage')" />
    <SalesOrderForm v-else :back-to="backTo" @saved="order => opened(order.id)" />
  </SharedCreatePanel>
</template>
