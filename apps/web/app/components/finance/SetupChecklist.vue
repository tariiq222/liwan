<script setup lang="ts">
import { financeSetupSteps } from '@/composables/finance/financeSetupSteps'
import type { FinanceSetup } from '@/composables/finance/useFinanceSetup'

// The setup steps as a read-only checklist: every step links to the settings page that fixes it; a finished step is struck through with a "done" badge.
const props = defineProps<{ setup: FinanceSetup }>()
const { t } = useI18n()
const items = computed(() => financeSetupSteps(props.setup).map((step, index) => ({
  id: index + 1,
  name: t(`finance.setup.steps.${step.code}`),
  to: '/settings/apps/finance',
  done: step.done,
})))
</script>

<template>
  <SharedChecklist :items="items" :empty-text="t('finance.setup.stepsEmpty')" add-placeholder="" add-label="" :add="async () => {}" :done-label="t('finance.setup.done')" />
</template>
