<script setup lang="ts">
import type { Product } from '@liwan/contracts'
import { PRODUCT_LIST_KEYS, PRODUCT_PAGE_SIZE, PRODUCTS_LIST_PATH, parseProductListQuery } from '@/composables/products/productListParams'
import { useProducts } from '@/composables/products/useProducts'
import { listLocation, safeListReturnTo, useLastPageClamp, useRouteListFilters } from '@/composables/useRouteListFilters'
import ProductTable from './ProductTable.vue'

// The body of the products page: the filter bar (search by name, the type and the archived switch), then the table in one
// card with its pager. The filters live in the URL query, so a record and the browser's Back return to the same list.
// `background` is the list behind the create panel: it reads its filters from the panel's returnTo. The page owns the
// SharedListPage shell.
const props = defineProps<{ background?: boolean }>()
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const { hydrated, filterQuery, search, update } = useRouteListFilters({ background: () => props.background, fallbackPath: () => PRODUCTS_LIST_PATH, safeReturnTo: value => safeListReturnTo(PRODUCTS_LIST_PATH, value) })

const state = computed(() => parseProductListQuery(filterQuery.value))
const query = useProducts(state)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PRODUCT_PAGE_SIZE)))
useLastPageClamp({ page: () => state.value.page, total: () => query.data.value?.total, pageSize: PRODUCT_PAGE_SIZE })
const activeCount = computed(() => Number(Boolean(state.value.q)) + Number(state.value.type !== null))
const backTo = computed(() => listLocation(PRODUCTS_LIST_PATH, PRODUCT_LIST_KEYS, filterQuery.value, route.hash))
const recordTo = (product: Product) => ({ path: `${PRODUCTS_LIST_PATH}/${product.id}`, query: { returnTo: backTo.value } })

const ANY_TYPE = 'any'
const scopes = computed(() => [
  { value: 'active', label: t('products.status.active') },
  { value: 'archived', label: t('products.status.archived') },
])
const typeItems = computed(() => [
  { value: ANY_TYPE, label: t('products.type.any') },
  { value: 'goods', label: t('products.type.goods') },
  { value: 'service', label: t('products.type.service') },
])
function setScope(value: string | number) { void update({ archived: value === 'archived' ? '1' : undefined, page: undefined }) }
function setType(value: unknown) { void update({ type: value === ANY_TYPE ? undefined : String(value), page: undefined }) }
function clearFilters() { search.value = ''; void update({ q: undefined, type: undefined, page: undefined }) }
const emptyText = computed(() => t(activeCount.value ? 'app.noResults' : state.value.archived ? 'products.emptyArchived' : 'products.empty'))
</script>

<template>
  <SharedForbiddenState v-if="!can('products.read')" />
  <div v-else class="flex min-w-0 flex-col gap-4">
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('products.search')" :aria-label="t('products.search')" :disabled="!hydrated" data-testid="products-search" />
            </form>
          </template>
          <USelect :model-value="state.type ?? ANY_TYPE" :items="typeItems" :aria-label="t('products.columns.type')" :disabled="!hydrated" data-testid="products-type" @update:model-value="setType" />
          <template #view>
            <SharedSegmentedControl data-testid="products-scope" :label="t('products.status.label')" :items="scopes" :model-value="state.archived ? 'archived' : 'active'" @update:model-value="setScope" />
          </template>
        </SharedFilterBar>
      </template>
      <SharedPageState v-if="query.error.value && !query.data.value" :error="query.error.value" @retry="query.refetch()" />
      <SharedEmptyState v-else-if="!query.isPending.value && !items.length" class="m-(--liwan-card-pad-dense)" :title="emptyText">
        <template v-if="activeCount" #action><UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('products.clear')" @click="clearFilters" /></template>
      </SharedEmptyState>
      <ProductTable v-else :rows="items" :loading="query.isPending.value" :error="null" :record-to="recordTo" @retry="query.refetch()" />
      <template v-if="query.data.value && items.length" #footer>
        <SharedListFooter :count-label="t('products.footer', { shown: items.length, total }, total)" :page="state.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
