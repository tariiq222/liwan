<script setup lang="ts">
import type { FinanceZatcaBacklog } from '@liwan/contracts'
import { backlogTone } from './zatcaOnboarding'

// The documents still waiting on ZATCA, as the server counts them.
defineProps<{ backlog: FinanceZatcaBacklog }>()
const { t } = useI18n()
const ids = ['to_send', 'retry', 'rejected', 'blocked'] as const
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('financeGovernance.zatca.backlog.title')" :description="t('financeGovernance.zatca.backlog.hint')" data-testid="finance-zatca-backlog">
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <SharedMetricTile v-for="id in ids" :key="id" density="compact" value-dir="ltr" :label="t(`financeGovernance.zatca.backlog.${id}`)" :value="backlog[id]" :tone="backlogTone(id, backlog[id])" :data-testid="`finance-zatca-backlog-${id}`" />
    </div>
  </SharedRecordSection>
</template>
