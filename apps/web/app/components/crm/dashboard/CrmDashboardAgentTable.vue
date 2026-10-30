<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { CrmDashboardAgentRowSchema } from '@liwan/contracts'
import type { z } from 'zod'

// One row per agent who holds records: open, due now and won. The server orders the rows.
type Row = z.infer<typeof CrmDashboardAgentRowSchema>
defineProps<{ agents: Row[] }>()
const { t } = useI18n()
const number = (id: string, header: string): TableColumn<Row> => ({ id, header, meta: { class: { th: 'text-start w-[84px]', td: 'whitespace-nowrap tabular-nums' } } as TableColumn<Row>['meta'] })
const columns = computed<TableColumn<Row>[]>(() => [
  { id: 'agent', header: t('crm.dashboard.manager.agentCols.agent'), meta: { class: { th: 'text-start', td: 'max-w-0' } } as TableColumn<Row>['meta'] },
  number('open', t('crm.dashboard.manager.agentCols.open')),
  number('due', t('crm.dashboard.manager.agentCols.due')),
  number('won', t('crm.dashboard.manager.agentCols.won')),
])
</script>

<template>
  <SharedRecordSection variant="list" :title="t('crm.dashboard.manager.agentsTitle')" data-testid="crm-agent-table">
    <SharedEmptyState v-if="!agents.length" class="m-(--liwan-card-pad-dense)" :title="t('crm.dashboard.manager.agentsEmpty')" />
    <SharedDataTable v-else bare :rows="agents" :columns="columns" row-key="user_id" :caption="t('crm.dashboard.manager.agentsTitle')">
      <template #agent-cell="{ row }"><span class="block truncate font-semibold text-highlighted">{{ row.original.name }}</span></template>
      <template #open-cell="{ row }">{{ row.original.open }}</template>
      <template #due-cell="{ row }"><span :class="{ 'text-warning': row.original.due }">{{ row.original.due }}</span></template>
      <template #won-cell="{ row }">{{ row.original.won }}</template>
      <template #mobile-row="{ row }">
        <div class="flex min-w-0 flex-col gap-1">
          <span class="truncate font-semibold text-highlighted">{{ row.name }}</span>
          <span class="text-sm text-muted">{{ t('crm.dashboard.manager.agentCols.open') }} {{ row.open }} · {{ t('crm.dashboard.manager.agentCols.due') }} {{ row.due }} · {{ t('crm.dashboard.manager.agentCols.won') }} {{ row.won }}</span>
        </div>
      </template>
    </SharedDataTable>
  </SharedRecordSection>
</template>
