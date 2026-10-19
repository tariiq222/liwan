<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { useFinancePartnerOptions, type PartnerPickerKind } from '@/composables/finance/useFinanceInvoices'

// One partner chosen from /finance/partners. `known` names the id that is selected but not in the current results
// (a record opened for editing), so the trigger never shows a bare number.
const props = defineProps<{
  modelValue: number | null
  kind: PartnerPickerKind
  known?: { id: number; name: string } | null
  placeholder?: string
  disabled?: boolean
  id?: string
  ariaLabel?: string
  invalid?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const q = ref('')
const search = refDebounced(q, 250)
const partners = useFinancePartnerOptions(() => props.kind, search)

const items = computed(() => {
  const rows = (partners.data.value?.items ?? []).map(partner => ({ label: partner.name, value: partner.id }))
  const selected = props.known && !rows.some(row => row.value === props.known!.id) ? [{ label: props.known.name, value: props.known.id }] : []
  return [...selected, ...rows]
})
</script>

<template>
  <USelectMenu
    :id="props.id"
    v-model:search-term="q"
    :model-value="props.modelValue ?? undefined"
    :items="items"
    value-key="value"
    :ignore-filter="true"
    :loading="partners.isFetching.value"
    :placeholder="props.placeholder ?? t('financeDocuments.partnerPicker.placeholder')"
    :search-input="{ placeholder: t('app.search') }"
    :disabled="props.disabled || !hydrated"
    :aria-label="props.ariaLabel"
    :color="props.invalid ? 'error' : undefined"
    class="w-full"
    data-testid="finance-partner-picker"
    @update:model-value="value => emit('update:modelValue', (value as number | undefined) ?? null)"
  />
</template>
