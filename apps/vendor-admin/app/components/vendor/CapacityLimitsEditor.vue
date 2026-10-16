<script setup lang="ts">
import { limitFromDraft, type LimitDraft } from '@/utils/vendorCommercial'
const props = withDefaults(defineProps<{ modelValue: Record<string, LimitDraft>; keys: string[]; labels: Record<string, string>; hints?: Record<string, string>; disabled?: boolean; showErrors?: boolean; serverErrors?: Record<string, string>; noneAllowed?: boolean }>(), { disabled: false, showErrors: false, noneAllowed: true })
const emit = defineEmits<{ 'update:modelValue': [Record<string, LimitDraft>] }>()
const { t } = useI18n(); const hydrated = useHydrated()
const patch = (key: string, limit: LimitDraft) => emit('update:modelValue', { ...props.modelValue, [key]: limit })
function error(key: string) {
  if (props.serverErrors?.[key]) return props.serverErrors[key]
  if (!props.showErrors) return undefined
  try { limitFromDraft(props.modelValue[key]); return undefined } catch { return t(props.modelValue[key]?.mode === 'number' ? 'vendor.pricing.limit.invalid' : 'vendor.pricing.limit.required') }
}
</script>
<template>
  <div class="grid gap-4 sm:grid-cols-2" data-slot="capacity-limits-editor">
    <UFormField v-for="key in keys" :key="key" :label="labels[key] ?? key" required :help="hints?.[key]" :error="error(key)">
      <VendorLimitControl :model-value="modelValue[key]" :label="labels[key] ?? key" :none-allowed="noneAllowed" :disabled="!hydrated || disabled" @update:model-value="patch(key, $event)" />
      <p v-if="modelValue[key]?.mode === 'none'" class="mt-1 text-sm text-warning">{{ t('vendor.pricing.limit.noneHint') }}</p>
    </UFormField>
  </div>
</template>
