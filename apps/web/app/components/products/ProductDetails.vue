<script setup lang="ts">
import type { Product } from '@liwan/contracts'
import { formatCurrency } from '@/utils/formatCurrency'

// The aside of a product record: its properties, then the price of one unit as the products service computes it (the
// price as typed, before tax, the tax and the total). The taxes show only when the product shape carries them. The API
// never returns the image file, so only whether the product has one is shown.
const props = defineProps<{ product: Product }>()
const { t, n, locale } = useI18n()
const money = (amount: number) => formatCurrency(amount, props.product.price.currency.name, locale.value)
</script>

<template>
  <SharedPropertiesPanel :title="t('products.record.details')">
    <SharedPropertyRow :label="t('products.columns.type')" :value="t(`products.type.${product.type}`)" />
    <SharedPropertyRow :label="t('products.form.description')" :value="product.description" />
    <SharedPropertyRow :label="t('products.record.image')" :value="t(product.has_image ? 'products.record.hasImage' : 'products.record.noImage')" data-testid="product-has-image" />
    <SharedPropertyRow :label="t('products.record.scope')" :value="product.company?.name ?? t('products.sharedByAllBranches')" />
  </SharedPropertiesPanel>
  <SharedPropertiesPanel :title="t('products.record.price')">
    <SharedPropertyRow :label="t('products.columns.listPrice')"><bdi dir="ltr" data-testid="product-list-price">{{ money(product.price.unit_price) }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('products.record.untaxed')"><bdi dir="ltr">{{ money(product.price.amount_untaxed) }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('products.record.tax')"><bdi dir="ltr">{{ money(product.price.amount_tax) }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('products.columns.total')"><bdi dir="ltr" data-testid="product-total">{{ money(product.price.amount_total) }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('products.record.currency')" :value="product.price.currency.name" />
    <SharedPropertyRow v-if="product.taxes" :label="t('products.record.taxes')">
      <ul v-if="product.taxes.length" class="flex flex-col gap-0.5" data-testid="product-taxes">
        <li v-for="tax in product.taxes" :key="tax.id">{{ t('products.tax.label', { name: tax.name, rate: n(tax.amount) }) }}</li>
      </ul>
      <template v-else>{{ t('products.tax.none') }}</template>
    </SharedPropertyRow>
  </SharedPropertiesPanel>
</template>
