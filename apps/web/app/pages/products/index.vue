<script setup lang="ts">
import ProductDirectory from '@/components/products/ProductDirectory.vue'
import { productListLocation } from '@/composables/products/productListParams'

const { t } = useI18n()
const route = useRoute()
const { can } = useAccess()
// The create link carries the list's state as its returnTo, so closing the panel returns to the same list.
const createTo = computed(() => can('products.manage')
  ? { path: '/products/new', query: { returnTo: productListLocation(route.query, route.hash) } }
  : undefined)
</script>

<template>
  <SharedListPage :title="t('products.title')" :create-to="createTo" :create-label="t('products.new')" create-test-id="product-new">
    <ProductDirectory />
  </SharedListPage>
</template>
