<script setup lang="ts">
import EntryForm from './EntryForm.vue'
import EntryLinesPanel from './EntryLinesPanel.vue'
import { entryDraftFromRecord } from './entryLines'
import type { EntryRecordState } from './useEntryRecord'

// The main column of an entry's record page: the inline message and confirmation of its actions, then the lines, or
// the draft's editor while it is being edited.
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
    <EntryForm
      v-if="record.editing && record.actions?.edit"
      :record-id="record.entry.id"
      :initial="entryDraftFromRecord(record.entry)"
      :back-to="record.backTo"
      @saved="record.editing = false"
      @cancel="record.editing = false"
    />
    <EntryLinesPanel v-else :entry="record.entry" />
  </template>
</template>
