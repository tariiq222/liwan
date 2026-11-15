<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import SalesOrderForm from '@/components/sales/SalesOrderForm.vue'
import { useSalesOrder } from '@/composables/sales/useSalesOrders'

const route = useRoute()
const sourcePaths = useRecordListPaths(['/sales'])
const { t } = useI18n()
const id = computed(() => Number(route.params.id))
const query = useSalesOrder(id)
const order = computed(() => query.data.value)
// Child pages always return to their current record; the list's referrer is carried as listOrigin.
const backTo = computed(() => recordParentTo(`/sales/${id.value}`, {
  ...route.query, listOrigin: route.query.listOrigin ?? route.query.returnTo ?? null,
}, sourcePaths.value, route.hash))
// DESIGN.md section 5: a saved form is not sent again through Back, so the record replaces the editor in the history.
function saved() { void navigateTo(backTo.value, { replace: true }) }
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('sales.edit')" :back-to="backTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!order" @retry="query.refetch()">
      <SharedPageState v-if="order && !order.actions.edit" :empty="true" :empty-text="t('sales.record.notEditable')" />
      <SalesOrderForm v-else-if="order" :order="order" :back-to="backTo" @saved="saved" />
    </SharedPageState>
  </SharedPageContainer>
</template>
