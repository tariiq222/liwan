<script setup lang="ts">
import type { EntryRecordState } from './useEntryRecord'

// The header actions of an entry's record page: the one that moves it forward, edit and a menu for the rest.
defineProps<{ record: EntryRecordState }>()
const { t } = useI18n()
</script>

<template>
  <template v-if="record.actions">
    <UButton v-if="record.actions.offers('post') && !record.editing" color="primary" icon="i-lucide-check" :disabled="!record.hydrated || record.busy || !record.actions.can('post')" :label="t('financeAccounting.actions.post')" data-testid="finance-entry-post" @click="record.ask('post')" />
    <UButton v-if="record.actions.offers('edit') && !record.editing" color="neutral" variant="outline" icon="i-lucide-pencil" :disabled="!record.hydrated || record.busy || !record.actions.can('edit')" :label="t('app.edit')" data-testid="finance-entry-edit" @click="record.edit()" />
    <SharedRowActions v-if="record.menu.length && !record.editing" :actions="record.menu" :label="t('financeAccounting.actions.menuFor', { name: record.title })" :disabled="record.busy" />
  </template>
</template>
