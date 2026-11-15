<script setup lang="ts">
import ProductDirectory from '@/components/products/ProductDirectory.vue'
import ProductForm from '@/components/products/ProductForm.vue'
import { PRODUCTS_LIST_PATH } from '@/composables/products/productListParams'
import { safeListReturnTo } from '@/composables/useRouteListFilters'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const backTo = computed(() => safeListReturnTo(PRODUCTS_LIST_PATH, route.query.returnTo))
function opened(id: number) { void navigateTo({ path: `${PRODUCTS_LIST_PATH}/${id}`, query: { returnTo: backTo.value } }, { replace: true }) }
</script>

<template>
  <SharedListPage :title="t('products.title')" hide-header>
    <ProductDirectory background />
  </SharedListPage>
  <SharedCreatePanel :title="t('products.new')" :back-to="backTo">
    <SharedForbiddenState v-if="!can('products.manage')" />
    <ProductForm v-else :back-to="backTo" @saved="product => opened(product.id)" />
  </SharedCreatePanel>
</template>
