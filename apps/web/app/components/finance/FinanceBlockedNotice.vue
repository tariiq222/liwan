<script setup lang="ts">
import type { FinanceActionBlockReason } from '@liwan/contracts'

// Why a button of the record page is disabled: one line per reason the server blocks an offered action for.
defineProps<{ reasons: readonly FinanceActionBlockReason[] }>()
const { t } = useI18n()
</script>

<template>
  <UAlert
    v-if="reasons.length"
    color="warning"
    variant="subtle"
    icon="i-lucide-lock"
    :title="t('finance.actionBlocked.title')"
    data-testid="finance-blocked-notice"
  >
    <template #description>
      <ul class="list-disc ps-4">
        <li v-for="reason in reasons" :key="reason">{{ t(`finance.actionBlocked.${reason}`) }}</li>
      </ul>
    </template>
  </UAlert>
</template>
