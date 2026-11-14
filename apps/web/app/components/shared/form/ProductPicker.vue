<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import type { ProductPick } from '@liwan/contracts'
import { useProductPick } from '@/composables/useProductPick'
import { formatCurrency } from '@/utils/formatCurrency'

// The one picker for choosing a product of the products service from /api/v1/products/pick: a search box over the list
// of active products, each shown with its name and the total price of one unit (tax included). Tap a product to pick it
// and tap it again to drop it. `exclude` hides products the caller already holds. It cannot make a product: a tenant
// with no product yet is told that products are added from the products list.
const props = defineProps<{
  modelValue: number | null
  exclude?: number[]
  disabled?: boolean
  ariaLabel?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null]; resolve: [product: ProductPick | null] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const q = ref('')
const search = refDebounced(q, 250)
const query = useProductPick(search)
const items = computed(() => {
  const excluded = new Set(props.exclude ?? [])
  return (query.data.value?.items ?? []).filter(product => !excluded.has(product.id))
})
const off = computed(() => props.disabled || !hydrated.value)

function toggle(product: ProductPick) {
  const picked = props.modelValue === product.id
  emit('update:modelValue', picked ? null : product.id)
  emit('resolve', picked ? null : product)
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="product-picker">
    <UInput v-model="q" class="w-full" icon="i-lucide-search" :placeholder="t('app.productPicker.search')" :aria-label="props.ariaLabel ?? t('app.productPicker.search')" :disabled="off" data-testid="product-picker-search" />
    <SharedLoadingSkeleton v-if="query.isPending.value" />
    <SharedPageState v-else-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <p v-else-if="!items.length" class="text-sm text-muted" data-testid="product-picker-empty">{{ q.trim() ? t('app.noResults') : t('app.productPicker.empty') }}</p>
    <ul v-else class="flex max-h-72 flex-col divide-y divide-default overflow-y-auto rounded-control ring ring-default" :aria-label="t('app.productPicker.listLabel')">
      <li v-for="product in items" :key="product.id">
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
          :class="{ 'bg-(--brand-soft)': props.modelValue === product.id }"
          :aria-pressed="props.modelValue === product.id"
          :disabled="off"
          :data-testid="`product-picker-option-${product.id}`"
          @click="toggle(product)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-highlighted">{{ product.name }}</span>
            <span class="block truncate text-xs text-muted"><bdi dir="ltr">{{ formatCurrency(product.amount_total, product.currency.name, locale) }}</bdi></span>
          </span>
          <UIcon :name="props.modelValue === product.id ? 'i-lucide-circle-check' : 'i-lucide-circle'" class="size-5 shrink-0" :class="props.modelValue === product.id ? 'text-primary' : 'text-muted'" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>
