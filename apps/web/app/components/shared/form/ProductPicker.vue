<script setup lang="ts">
import type { ProductPick } from '@liwan/contracts'
import { useProductPick } from '@/composables/useProductPick'
import { formatCurrency } from '@/utils/formatCurrency'

// The one picker for choosing a product of the products service from /api/v1/products/pick: a search box over the list
// of active products, each shown with its name and the total price of one unit (tax included). Tap a product to pick it
// and tap it again to drop it. `exclude` hides products the caller already holds. It cannot make a product: a tenant
// with no product yet is told that products are added from the products list, with a link to the new-product page for
// a holder of `products.manage`.
const props = defineProps<{
  modelValue: number | null
  exclude?: number[]
  disabled?: boolean
  ariaLabel?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null]; resolve: [product: ProductPick | null] }>()
const { t, locale } = useI18n()
const { can } = useAccess()
const search = ref('')
// A locked picker asks for nothing: the pick list answers 403 to whoever may not pick.
const query = useProductPick(search, computed(() => !props.disabled))
const items = computed(() => {
  const excluded = new Set(props.exclude ?? [])
  return (query.data.value?.items ?? []).filter(product => !excluded.has(product.id))
})
</script>

<template>
  <SharedPickList
    :model-value="props.modelValue"
    :items="items"
    :loading="query.isLoading.value"
    :error="query.error.value"
    :disabled="props.disabled"
    test-id="product-picker"
    :search-label="t('app.productPicker.search')"
    :list-label="t('app.productPicker.listLabel')"
    :empty-text="t('app.productPicker.empty')"
    :aria-label="props.ariaLabel"
    :create-to="can('products.manage') ? '/products/new' : undefined"
    :create-label="t('app.productPicker.create')"
    @update:model-value="emit('update:modelValue', $event)"
    @resolve="emit('resolve', $event)"
    @update:search="search = $event"
    @retry="query.refetch()"
  >
    <template #row="{ item: product }">
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-highlighted">{{ product.name }}</span>
        <span class="block truncate text-xs text-muted"><bdi dir="ltr">{{ formatCurrency(product.amount_total, product.currency.name, locale) }}</bdi></span>
      </span>
    </template>
  </SharedPickList>
</template>
