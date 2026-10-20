<script setup lang="ts">
import EntryLinesPanel from './EntryLinesPanel.vue'
import type { EntryRecordState } from './useEntryRecord'

// The main column of an entry's record page: the inline message and confirmation of its actions, then the lines.
defineProps<{ record: EntryRecordState }>()
</script>

<template>
  <UAlert v-if="record.actionError" role="alert" color="error" variant="subtle" :title="record.actionError" data-testid="finance-entry-action-error" />
  <template v-if="record.entry">
    <SharedInlineConfirm
      v-if="record.confirmation"
      :title="record.confirmation.title"
      :description="record.confirmation.description"
      :confirm-label="record.confirmation.confirmLabel"
      :color="record.confirmation.color"
      :pending="record.busy"
      :disabled="!record.hydrated"
      @confirm="record.applyConfirmation()"
      @cancel="record.confirming = null"
    />
    <EntryLinesPanel :entry="record.entry" />
  </template>
</template>
