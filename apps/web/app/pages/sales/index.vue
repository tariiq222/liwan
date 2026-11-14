<script setup lang="ts">
import SalesOrderDirectory from '@/components/sales/SalesOrderDirectory.vue'
import { salesListLocation } from '@/composables/sales/salesListParams'

const { t } = useI18n()
const route = useRoute()
const { can } = useAccess()
// The create link carries the list's state as its returnTo, so closing the panel returns to the same list.
const createTo = computed(() => can('sales.quotations.manage')
  ? { path: '/sales/new', query: { returnTo: salesListLocation(route.query, route.hash) } }
  : undefined)
</script>

<template>
  <SharedListPage :title="t('sales.title')" :create-to="createTo" :create-label="t('sales.new')" create-test-id="sales-new">
    <SalesOrderDirectory />
  </SharedListPage>
</template>
