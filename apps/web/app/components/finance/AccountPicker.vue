<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import type { FinanceAccount } from '@liwan/contracts'
import { useFinanceAccountOptions } from '@/composables/finance/useFinanceAccounts'

// One account chosen from the chart of accounts, found by the typed code or name; `allow` leaves out the accounts the
// caller's endpoint refuses. The chosen account stays in the list while the search text changes, so the trigger never
// shows a bare number. `accountType` and `reconcile` narrow the search on the server; `selectedLabel` names the account
// the model already holds before anything was chosen here (a saved setting), so it never shows as a bare number either.
const props = defineProps<{
  modelValue: number | null
  id?: string
  disabled?: boolean
  invalid?: boolean
  ariaLabel?: string
  placeholder?: string
  allow?: (account: FinanceAccount) => boolean
  accountType?: FinanceAccount['account_type']
  reconcile?: boolean
  selectedLabel?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const q = ref('')
const search = refDebounced(q, 250)
const accounts = useFinanceAccountOptions(search, () => ({ accountType: props.accountType, reconcile: props.reconcile }))
const chosen = ref<{ label: string; value: number } | null>(null)

const items = computed(() => {
  const rows = (accounts.data.value?.items ?? []).filter(account => props.allow?.(account) ?? true).map(account => ({ label: `${account.code} ${account.name}`, value: account.id }))
  const known = chosen.value ?? (props.modelValue !== null && props.selectedLabel ? { label: props.selectedLabel, value: props.modelValue } : null)
  const kept = known && known.value === props.modelValue && !rows.some(row => row.value === known.value) ? [known] : []
  return [...kept, ...rows]
})
function choose(value: number | undefined) {
  chosen.value = items.value.find(item => item.value === value) ?? null
  emit('update:modelValue', value ?? null)
}
</script>

<template>
  <USelectMenu
    :id="props.id"
    v-model:search-term="q"
    :model-value="props.modelValue ?? undefined"
    :items="items"
    value-key="value"
    :ignore-filter="true"
    :loading="accounts.isFetching.value"
    :placeholder="props.placeholder ?? t('financeAccounting.form.accountPlaceholder')"
    :search-input="{ placeholder: t('app.search') }"
    :disabled="props.disabled || !hydrated"
    :aria-label="props.ariaLabel"
    :color="props.invalid ? 'error' : undefined"
    class="w-full"
    data-testid="finance-account-picker"
    @update:model-value="value => choose(value as number | undefined)"
  />
</template>
