<script setup lang="ts">
import type { BankStatementRecordState } from './useBankStatementRecord'

// The header actions of a statement's record page: correct its name and balances, or remove it.
defineProps<{ record: BankStatementRecordState }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
</script>

<template>
  <template v-if="can('finance.bank.manage')">
    <UButton color="neutral" variant="outline" icon="i-lucide-pencil" :disabled="!hydrated || record.editing || record.deleting" :label="t('financeBank.edit.action')" data-testid="finance-bank-edit" @click="record.editing = true" />
    <UButton color="error" variant="outline" icon="i-lucide-trash-2" :disabled="!hydrated || record.editing || record.deleting" :label="t('financeBank.delete.action')" data-testid="finance-bank-delete" @click="record.deleting = true" />
  </template>
</template>
