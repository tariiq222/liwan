<script setup lang="ts">
import type { BudgetRecordState } from './useBudgetRecord'

// The header actions of a budget's record page: the one that moves it forward and a menu for the rest.
defineProps<{ record: BudgetRecordState }>()
const { t } = useI18n()
</script>

<template>
  <template v-if="record.actions">
    <UButton v-if="record.actions.offers('confirm')" color="primary" icon="i-lucide-check" :disabled="!record.hydrated || record.busy || !record.actions.can('confirm')" :label="t('financeBudgets.actions.confirm')" data-testid="finance-budget-confirm" @click="record.ask('confirm')" />
    <SharedRowActions v-if="record.menu.length" :actions="record.menu" :label="t('financeBudgets.actions.menuFor', { name: record.title })" :disabled="record.busy" />
  </template>
</template>
