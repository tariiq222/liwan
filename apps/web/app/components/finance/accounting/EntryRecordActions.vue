<script setup lang="ts">
import type { EntryRecordState } from './useEntryRecord'

// The header actions of an entry's record page: the one that moves it forward and a menu for the rest.
defineProps<{ record: EntryRecordState }>()
const { t } = useI18n()
</script>

<template>
  <template v-if="record.actions">
    <UButton v-if="record.actions.post" color="primary" icon="i-lucide-check" :disabled="!record.hydrated || record.busy" :label="t('financeAccounting.actions.post')" data-testid="finance-entry-post" @click="record.ask('post')" />
    <SharedRowActions v-if="record.menu.length" :actions="record.menu" :label="t('financeAccounting.actions.menuFor', { name: record.title })" :disabled="record.busy" />
  </template>
</template>
