<script setup lang="ts">
import type { FinanceSummary } from '@webvue/contracts'
import { useSetActualAccount } from '@/composables/useProjectFinance'
import { actualAccountErrorKey, actualAccountLabel } from '@/utils/projectFinance'

const NONE = 'none'
const props = defineProps<{ projectId: number; summary: FinanceSummary }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { available, query } = useRecordPicker('cost-center')
const { mutate, isPending } = useSetActualAccount()
const error = ref('')

const current = computed(() => props.summary.actual_account)
const selected = computed(() => current.value ? String(current.value.id) : NONE)
const items = computed(() => {
  const options = (query.data.value ?? []).map(option => ({ label: option.name, value: String(option.id) }))
  const linked = current.value
  const withLinked = linked && !options.some(option => option.value === String(linked.id)) ? [{ label: actualAccountLabel(linked), value: String(linked.id) }, ...options] : options
  return [{ label: t('projects.finance.actualAccount.none'), value: NONE }, ...withLinked]
})

function choose(value: unknown) {
  const raw = String(value)
  if (raw === selected.value) return
  error.value = ''
  mutate(
    { projectId: props.projectId, accountId: raw === NONE ? null : Number(raw) },
    { onError: (e) => { error.value = t(actualAccountErrorKey(e)) } },
  )
}
</script>

<template>
  <SharedRecordSection v-if="available" variant="tinted" data-testid="finance-actual-account-picker" :title="t('projects.finance.actualAccount.title')" :description="t('projects.finance.actualAccount.hint')">
    <UFormField name="account_id" :label="t('projects.finance.actualAccount.label')" :error="error || undefined">
      <USelectMenu
        id="finance-actual-account"
        :model-value="selected"
        :items="items"
        value-key="value"
        class="w-full"
        :loading="query.isLoading.value"
        :disabled="!hydrated || isPending"
        :placeholder="t('projects.finance.actualAccount.none')"
        :search-input="{ placeholder: t('projects.finance.actualAccount.search') }"
        :aria-label="t('projects.finance.actualAccount.label')"
        @update:model-value="choose"
      />
    </UFormField>
    <p v-if="query.error.value" role="alert" class="mt-2 text-sm text-error">{{ t('projects.finance.actualAccount.loadError') }}</p>
  </SharedRecordSection>
</template>
