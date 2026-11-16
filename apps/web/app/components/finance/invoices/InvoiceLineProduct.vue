<script setup lang="ts">
import type { ProductPick } from '@liwan/contracts'

// The optional product of one invoice or credit note line. A chosen product shows by name with a way to change or drop
// it; "pick" opens the shared product picker. Picking fills the line from the product (the form does that on `resolve`),
// the line stays editable, and a line with no product is as valid as before.
const props = defineProps<{
  /** The product the line names, and its name (the product may be archived since, so it is not looked up). */
  productId: number | null
  productName: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:productId': [value: number | null]; resolve: [product: ProductPick | null] }>()
const { t } = useI18n()
const picking = ref(false)

function pick(product: ProductPick | null) {
  emit('resolve', product)
  picking.value = false
}
</script>

<template>
  <div class="grid gap-2" data-testid="finance-line-product">
    <div class="flex flex-wrap items-center gap-2">
      <p v-if="productId" class="flex min-w-0 items-center gap-2 text-sm" data-testid="finance-line-product-name">
        <UIcon name="i-lucide-package" class="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span class="truncate font-medium text-highlighted">{{ productName }}</span>
      </p>
      <p v-else class="text-sm text-muted">{{ t('financeDocuments.form.productNone') }}</p>
      <UButton v-if="!picking" type="button" size="sm" color="neutral" variant="outline" :icon="productId ? 'i-lucide-replace' : 'i-lucide-search'" :disabled="disabled" :label="productId ? t('financeDocuments.form.productChange') : t('financeDocuments.form.productPick')" data-testid="finance-line-product-open" @click="picking = true" />
      <UButton v-else type="button" size="sm" color="neutral" variant="ghost" :label="t('app.cancel')" data-testid="finance-line-product-close" @click="picking = false" />
      <UButton v-if="productId && !picking" type="button" size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :disabled="disabled" :label="t('financeDocuments.form.productRemove')" data-testid="finance-line-product-remove" @click="pick(null)" />
    </div>
    <SharedProductPicker
      v-if="picking"
      :model-value="productId"
      :disabled="disabled"
      :aria-label="t('financeDocuments.form.productSearch')"
      @update:model-value="emit('update:productId', $event)"
      @resolve="pick"
    />
  </div>
</template>
