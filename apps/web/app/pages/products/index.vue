<script setup lang="ts">
import ProductDirectory from '@/components/products/ProductDirectory.vue'
import { PRODUCT_LIST_KEYS, PRODUCTS_LIST_PATH, parseProductListQuery } from '@/composables/products/productListParams'
import { useProductListKpis } from '@/composables/products/useProductKpis'
import { listLocation } from '@/composables/useRouteListFilters'

const { t } = useI18n()
const route = useRoute()
const { can } = useAccess()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()
const canRead = computed(() => can('products.read'))
const listTotal = ref<number | undefined>(undefined)
const listState = computed(() => parseProductListQuery(route.query))
const kpis = useProductListKpis(listState, listTotal, computed(() => kpisShown.value && canRead.value))
// The create link carries the list's state as its returnTo, so closing the panel returns to the same list.
const createTo = computed(() => can('products.manage')
  ? { path: '/products/new', query: { returnTo: listLocation(PRODUCTS_LIST_PATH, PRODUCT_LIST_KEYS, route.query, route.hash) } }
  : undefined)
</script>

<template>
  <SharedListPage :title="t('products.title')" :create-to="createTo" :create-label="t('products.new')" create-test-id="product-new">
    <template v-if="canRead" #kpis>
      <SharedKpiStrip v-if="hydrated" :tiles="kpis.tiles.value" :loading="kpis.loading.value" :label="t('products.kpi.label')" data-testid="products-kpi-strip" />
    </template>
    <ProductDirectory @update:total="listTotal = $event" />
  </SharedListPage>
</template>
