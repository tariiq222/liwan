<script setup lang="ts">
import type { FinanceSummary } from '@webvue/contracts'
import { actualAccountLabel } from '@/utils/projectFinance'

// Under the actual figure of a project whose actual comes from linked accounts: where it comes from and the cost center it reads.
defineProps<{ summary: FinanceSummary }>()
const { t } = useI18n()
</script>

<template>
  <div data-testid="finance-actual-source" class="mt-1.5 grid justify-items-start gap-1.5">
    <p class="text-xs text-muted">{{ t('projects.finance.actualSource.fromAccounts') }}</p>
    <SharedStatusBadge v-if="summary.actual_account" tone="neutral" icon="i-lucide-chart-pie" data-testid="finance-actual-account" :label="actualAccountLabel(summary.actual_account)" />
    <SharedStatusBadge v-else tone="warning" icon="i-lucide-link-2-off" data-testid="finance-actual-account-missing" :label="t('projects.finance.actualSource.noCostCenter')" />
  </div>
</template>
