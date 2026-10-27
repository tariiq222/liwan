<script setup lang="ts">
import type { EntryRecordState } from './useEntryRecord'

// The header actions of an entry's record page: the one that moves it forward, edit and a menu for the rest.
defineProps<{ record: EntryRecordState }>()
const { t } = useI18n()
</script>

<template>
  <template v-if="record.actions">
    <UButton v-if="record.actions.post && !record.editing" color="primary" icon="i-lucide-check" :disabled="!record.hydrated || record.busy" :label="t('financeAccounting.actions.post')" data-testid="finance-entry-post" @click="record.ask('post')" />
    <UButton v-if="record.actions.edit && !record.editing" color="neutral" variant="outline" icon="i-lucide-pencil" :disabled="!record.hydrated || record.busy" :label="t('app.edit')" data-testid="finance-entry-edit" @click="record.edit()" />
    <SharedRowActions v-if="record.menu.length && !record.editing" :actions="record.menu" :label="t('financeAccounting.actions.menuFor', { name: record.title })" :disabled="record.busy" />
  </template>
</template>
