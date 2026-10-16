<script setup lang="ts">
import { limitFromDraft, type LimitDraft } from '@/utils/vendorCommercial'
const props = withDefaults(defineProps<{ modelValue: Record<string, LimitDraft>; keys: string[]; labels: Record<string, string>; hints?: Record<string, string>; disabled?: boolean; showErrors?: boolean; serverErrors?: Record<string, string>; noneAllowed?: boolean }>(), { disabled: false, showErrors: false, noneAllowed: true })
const emit = defineEmits<{ 'update:modelValue': [Record<string, LimitDraft>] }>()
const { t } = useI18n(); const hydrated = useHydrated()
const items = computed(() => [
  { label: t('vendor.pricing.limit.unlimited'), value: 'unlimited' },
  ...(props.noneAllowed ? [{ label: t('vendor.pricing.limit.none'), value: 'none' }] : []),
  { label: t('vendor.pricing.limit.number'), value: 'number' },
])
function patch(key: string, change: Partial<LimitDraft>) { emit('update:modelValue', { ...props.modelValue, [key]: { ...(props.modelValue[key] ?? { mode: '', value: '' }), ...change } }) }
function error(key: string) {
  if (props.serverErrors?.[key]) return props.serverErrors[key]
  if (!props.showErrors) return undefined
  try { limitFromDraft(props.modelValue[key]); return undefined } catch { return t(props.modelValue[key]?.mode === 'number' ? 'vendor.pricing.limit.invalid' : 'vendor.pricing.limit.required') }
}
</script>
<template>
  <div class="space-y-4" data-slot="capacity-limits-editor">
    <UFormField v-for="key in keys" :key="key" :label="labels[key] ?? key" required :help="hints?.[key]" :error="error(key)">
      <div class="flex flex-wrap gap-2">
        <USelect :model-value="modelValue[key]?.mode || undefined" :items="items" :placeholder="t('vendor.pricing.choose')" :disabled="!hydrated || disabled" :aria-label="labels[key] ?? key" @update:model-value="patch(key, { mode: $event as LimitDraft['mode'], value: '' })" />
        <UInput v-if="modelValue[key]?.mode === 'number'" :model-value="modelValue[key]?.value" inputmode="numeric" dir="ltr" :aria-label="labels[key] ?? key" :disabled="!hydrated || disabled" @update:model-value="patch(key, { value: String($event) })" />
      </div>
      <p v-if="modelValue[key]?.mode === 'none'" class="mt-1 text-sm text-warning">{{ t('vendor.pricing.limit.noneHint') }}</p>
    </UFormField>
  </div>
</template>
