<script setup lang="ts">
import type { CrmPackage } from '@webvue/contracts'
import { derivedDiscountPercent } from '@/utils/crmOpportunity'
import { useCrmTerms } from '@/composables/crm/useCrmTerms'

export interface CrmSaleDraft { package_id: number | null; final_price: number | null }

// The sale fields shared by the call form (a sold outcome) and the sale action: the package, the final price
// (filled from the package price) and the discount, which is worked out from the two prices and only shown.
const props = defineProps<{ packages: CrmPackage[]; modelValue: CrmSaleDraft; disabled?: boolean; showErrors?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: CrmSaleDraft] }>()
const { t } = useI18n()
const { term } = useCrmTerms()
const selected = computed(() => props.packages.find(item => item.id === props.modelValue.package_id) ?? null)
const items = computed(() => props.packages.map(item => ({ value: item.id, label: `${item.name} (${item.price})` })))
const discount = computed(() => (selected.value && props.modelValue.final_price !== null ? derivedDiscountPercent(selected.value.price, props.modelValue.final_price) : 0))
const packageLabel = computed(() => term('package', 'one'))

function choose(value: unknown) {
  const next = props.packages.find(item => item.id === value)
  emit('update:modelValue', { package_id: next?.id ?? null, final_price: next?.price ?? null })
}
function setPrice(value: number | null | undefined) {
  emit('update:modelValue', { ...props.modelValue, final_price: value ?? null })
}
</script>

<template>
  <div class="grid gap-4" data-testid="crm-sale-form">
    <UFormField :label="packageLabel" name="sale-package" required :error="showErrors && !modelValue.package_id ? t('crm.opportunities.sale.packageRequired') : undefined">
      <USelect id="sale-package" class="w-full" :model-value="modelValue.package_id ?? undefined" :items="items" :placeholder="t('crm.opportunities.sale.packagePlaceholder')" :disabled="disabled" @update:model-value="choose" />
    </UFormField>
    <div class="grid gap-4 sm:grid-cols-3">
      <UFormField :label="t('crm.opportunities.sale.listPrice', { term: packageLabel })" name="sale-list-price">
        <UInput id="sale-list-price" class="w-full" :model-value="selected ? String(selected.price) : ''" readonly disabled />
      </UFormField>
      <UFormField :label="t('crm.opportunities.sale.finalPrice')" name="sale-final-price" required :error="showErrors && modelValue.final_price === null ? t('crm.opportunities.sale.priceRequired') : undefined">
        <UInputNumber id="sale-final-price" class="w-full" :model-value="modelValue.final_price ?? undefined" :min="0" :disabled="disabled || !selected" @update:model-value="setPrice" />
      </UFormField>
      <UFormField :label="t('crm.opportunities.sale.discount')" name="sale-discount" :help="t('crm.opportunities.sale.discountHint')">
        <UInput id="sale-discount" class="w-full" :model-value="`${discount}%`" readonly disabled data-testid="crm-sale-discount" />
      </UFormField>
    </div>
  </div>
</template>
