<script setup lang="ts">
import SalesTemplateDirectory from '@/components/sales/SalesTemplateDirectory.vue'
import { SALES_TEMPLATE_LIST_KEYS, SALES_TEMPLATES_PATH } from '@/composables/sales/salesTemplateParams'
import { listLocation } from '@/composables/useRouteListFilters'

// Quotation templates, a section of the Sales settings. Managing them is `sales.settings.manage`.
const { t } = useI18n()
const route = useRoute()
const { can } = useAccess()
useSettingsPage('sales')
// The create link carries the list's state as its returnTo, so closing the panel returns to the same list.
const createTo = computed(() => can('sales.settings.manage')
  ? { path: `${SALES_TEMPLATES_PATH}/new`, query: { returnTo: listLocation(SALES_TEMPLATES_PATH, SALES_TEMPLATE_LIST_KEYS, route.query, route.hash) } }
  : undefined)
</script>

<template>
  <SharedListPage :title="t('sales.templates.title')" :create-to="createTo" :create-label="t('sales.templates.new')" create-test-id="sales-template-new">
    <SalesTemplateDirectory />
  </SharedListPage>
</template>
