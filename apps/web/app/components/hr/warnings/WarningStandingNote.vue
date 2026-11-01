<script setup lang="ts">
import type { HrWarningStanding } from '@liwan/contracts'

// The escalation figure of one employee: how many warnings still count inside the company's window.
// Shown to issuers in the create form and on the record page; the counting rule is its help text.
const props = defineProps<{ standing: HrWarningStanding | null | undefined }>()
const { t } = useI18n()
</script>

<template>
  <UAlert
    v-if="props.standing"
    color="neutral"
    variant="subtle"
    icon="i-lucide-scale"
    :title="t('hrWarnings.standing.note', { count: props.standing.active_count, months: props.standing.window_months }, props.standing.active_count)"
    data-testid="hr-warning-standing"
  >
    <template #description>
      <p v-if="props.standing.highest_severity" data-testid="hr-warning-standing-highest">{{ t('hrWarnings.standing.highest', { severity: props.standing.highest_severity }) }}</p>
      <p>{{ t('hrWarnings.standing.rule') }}</p>
    </template>
  </UAlert>
</template>
