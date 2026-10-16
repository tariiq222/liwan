<script setup lang="ts">
import type { LimitDraft } from '@/utils/vendorCommercial'
const props = withDefaults(defineProps<{ modelValue?: LimitDraft; label: string; disabled?: boolean; noneAllowed?: boolean }>(), { disabled: false, noneAllowed: true })
const emit = defineEmits<{ 'update:modelValue': [LimitDraft] }>()
const { t } = useI18n()
const items = computed(() => [
  { label: t('vendor.pricing.limit.unlimited'), value: 'unlimited' },
  ...(props.noneAllowed ? [{ label: t('vendor.pricing.limit.none'), value: 'none' }] : []),
  { label: t('vendor.pricing.limit.number'), value: 'number' },
])
const numeric = computed(() => props.modelValue?.mode === 'number')
</script>
<template>
  <div class="flex gap-2" data-slot="limit-control">
    <USelect :model-value="modelValue?.mode || undefined" :items="items" :placeholder="t('vendor.pricing.choose')" :disabled="disabled" :aria-label="label" :class="numeric ? 'w-40 shrink-0' : 'w-full'" @update:model-value="emit('update:modelValue', { mode: $event as LimitDraft['mode'], value: '' })" />
    <UInput v-if="numeric" :model-value="modelValue?.value" inputmode="numeric" dir="ltr" class="min-w-0 flex-1" :aria-label="label" :disabled="disabled" @update:model-value="emit('update:modelValue', { mode: 'number', value: String($event) })" />
  </div>
</template>
