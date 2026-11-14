<script setup lang="ts">
import type { ProductTax, ProductTaxChoice } from '@liwan/contracts'

// The sale tax of a product: one choice from the establishment's taxes, labelled with name and rate. A choice that is
// switched off says picking it switches it on. A product that already carries several taxes lists them read-only; it is
// rewritten only when one is picked here. `choices` is empty when the taxes could not be read (the product belongs to
// another company), and then only the product's own taxes show.
const props = defineProps<{ modelValue: number | null; taxes?: ProductTax[]; choices: ProductTaxChoice[]; disabled?: boolean; error?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
const { t, n } = useI18n()

const label = (tax: ProductTax) => t('products.tax.label', { name: tax.name, rate: n(tax.amount) })
const several = computed(() => (props.taxes?.length ?? 0) > 1)
// Without a pick, a product with one tax shows that one as chosen.
const shown = computed(() => props.modelValue ?? (props.taxes?.length === 1 ? props.taxes[0]!.id : null))
const items = computed(() => props.choices.map(choice => ({
  value: choice.id,
  label: choice.active ? label(choice) : t('products.tax.inactive', { tax: label(choice) }),
})))
function pick(value: unknown) { emit('update:modelValue', typeof value === 'number' ? value : null) }
</script>

<template>
  <UFormField :label="t('products.form.tax')" name="product-tax" :error="props.error" :help="several ? t('products.tax.several') : undefined">
    <ul v-if="several" class="mb-2 list-disc ps-5 text-sm text-default" data-testid="product-taxes-current">
      <li v-for="tax in props.taxes" :key="tax.id">{{ label(tax) }}</li>
    </ul>
    <USelect v-if="items.length" :model-value="shown ?? undefined" :items="items" :placeholder="t('products.tax.placeholder')" class="w-full" :disabled="props.disabled" data-testid="product-tax" @update:model-value="pick" />
    <p v-else-if="!several" class="text-sm text-default" data-testid="product-taxes-current">{{ props.taxes?.length ? label(props.taxes[0]!) : t('products.tax.none') }}</p>
  </UFormField>
</template>
