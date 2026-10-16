<script setup lang="ts">
import { emptyPrice, priceRowErrors, type PriceDraft } from '@/utils/vendorCommercial'
const props = withDefaults(defineProps<{ modelValue: PriceDraft[]; label: string; hint?: string; disabled?: boolean; showErrors?: boolean; serverError?: string }>(), { disabled: false, showErrors: false })
const emit = defineEmits<{ 'update:modelValue': [PriceDraft[]] }>()
const { t } = useI18n(); const hydrated = useHydrated()
const errors = computed(() => priceRowErrors(props.modelValue))
function patch(index: number, change: Partial<PriceDraft>) { emit('update:modelValue', props.modelValue.map((row, i) => (i === index ? { ...row, ...change } : row))) }
const add = () => emit('update:modelValue', [...props.modelValue, emptyPrice()])
const remove = (index: number) => emit('update:modelValue', props.modelValue.filter((_, i) => i !== index))
const unitItems = computed(() => [{ label: t('vendor.pricing.cadence.month.unit'), value: 'month' }, { label: t('vendor.pricing.cadence.year.unit'), value: 'year' }])
</script>
<template>
  <div class="space-y-3" data-slot="price-list-editor">
    <p class="text-sm font-medium text-highlighted">{{ label }}</p>
    <p v-if="hint" class="text-sm text-muted">{{ hint }}</p>
    <SharedEmptyState v-if="!modelValue.length" :title="t('vendor.pricing.prices.empty')" />
    <div v-for="(row, index) in modelValue" :key="index" class="grid items-start gap-3 sm:grid-cols-[1fr_6rem_1fr_auto]">
      <UFormField :label="t('vendor.pricing.prices.unit')" :error="showErrors && errors[index] === 'cadence' ? t('vendor.pricing.prices.cadenceInvalid') : showErrors && errors[index] === 'duplicate' ? t('vendor.pricing.prices.duplicate') : undefined">
        <USelect :model-value="row.unit || undefined" :items="unitItems" :placeholder="t('vendor.pricing.choose')" class="w-full" :disabled="!hydrated || disabled" @update:model-value="patch(index, { unit: $event as PriceDraft['unit'] })" />
      </UFormField>
      <UFormField :label="t('vendor.pricing.prices.count')">
        <UInput :model-value="row.count" inputmode="numeric" class="w-full" :disabled="!hydrated || disabled" @update:model-value="patch(index, { count: String($event) })" />
      </UFormField>
      <UFormField :label="t('vendor.pricing.prices.amount')" :error="showErrors && errors[index] === 'amount' ? t('vendor.pricing.prices.amountInvalid') : undefined">
        <UInput :model-value="row.amount" inputmode="decimal" class="w-full" :disabled="!hydrated || disabled" @update:model-value="patch(index, { amount: String($event) })"><template #trailing><span class="text-xs text-muted">{{ t('vendor.pricing.sar') }}</span></template></UInput>
      </UFormField>
      <UButton color="error" variant="ghost" icon="i-lucide-trash-2" class="sm:mt-6" :aria-label="t('vendor.pricing.prices.remove')" :disabled="!hydrated || disabled" @click="remove(index)" />
    </div>
    <p v-if="serverError" class="text-sm text-error">{{ serverError }}</p>
    <UButton color="neutral" variant="outline" icon="i-lucide-plus" :disabled="!hydrated || disabled" @click="add">{{ t('vendor.pricing.prices.add') }}</UButton>
  </div>
</template>
