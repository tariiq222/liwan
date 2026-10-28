<script setup lang="ts">
import BudgetLinesPanel from './BudgetLinesPanel.vue'
import BudgetVsActualPanel from './BudgetVsActualPanel.vue'
import FinanceBlockedNotice from '../FinanceBlockedNotice.vue'
import type { BudgetRecordState } from './useBudgetRecord'

// The main column of a budget's record page: the inline message and confirmation of its actions, the lines and the
// comparison with the posted actuals.
defineProps<{ record: BudgetRecordState }>()
</script>

<template>
  <UAlert v-if="record.actionError" role="alert" color="error" variant="subtle" :title="record.actionError" data-testid="finance-budget-action-error" />
  <template v-if="record.budget">
    <FinanceBlockedNotice v-if="record.actions" :reasons="record.actions.reasons" />
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
    <BudgetLinesPanel :budget="record.budget" :editable="!!record.actions?.can('edit_lines')" />
    <BudgetVsActualPanel :budget-id="record.budget.id" />
  </template>
</template>
