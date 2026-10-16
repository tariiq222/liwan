<script setup lang="ts">
import { CATALOG_TABS, catalogTabOf } from '@/utils/vendorCatalog'
// The catalog section's tabs (plans, bundles, legacy packages): route-backed, one underline under the current list.
const { t } = useI18n(); const route = useRoute()
const active = computed(() => catalogTabOf(route.path)?.key)
const items = computed(() => CATALOG_TABS.map(tab => ({ key: `catalog-tab-${tab.key}`, label: t(tab.labelKey), to: tab.to, active: tab.key === active.value })))
</script>
<template><SharedRouteTabs :items="items" :ariaLabel="t('vendor.catalog.tabs')" /></template>
