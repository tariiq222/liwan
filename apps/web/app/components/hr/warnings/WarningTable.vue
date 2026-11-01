<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { HrWarning } from '@liwan/contracts'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { hrWarningBadge } from '@/utils/hrWarnings'

// The warning table of /hr/warnings: one row per warning with its employee, type, date and the
// state pill. It is a bare SharedDataTable inside the page's SharedListCard.
const props = defineProps<{
  warnings: HrWarning[]
  rowTo: (row: HrWarning) => RouteLocationRaw
  caption: string
  loading?: boolean
}>()

const { t } = useI18n()

const columns = computed<TableColumn<HrWarning>[]>(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { accessorKey: 'employee', header: t('hrWarnings.columns.employee') },
  { accessorKey: 'type', header: t('hrWarnings.columns.type') },
  { accessorKey: 'date_issued', header: t('hrWarnings.columns.date') },
  { accessorKey: 'state', header: t('hrWarnings.columns.state'), meta: { class: { th: 'w-[150px]', td: 'w-[150px]' } } },
])

function badge(warning: HrWarning) {
  const entry = hrWarningBadge(warning.state)
  return { tone: entry.tone, label: t(entry.labelKey) }
}
</script>

<template>
  <SharedDataTable
    bare
    :rows="props.warnings"
    :columns="columns"
    row-key="id"
    :row-to="props.rowTo"
    :loading="props.loading"
    :caption="props.caption"
  >
    <template #id-cell="{ row }"><RecordNumber :value="row.original.id" :data-testid="`hr-warning-row-${row.original.id}`" /></template>
    <template #employee-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.employee.name }}</span></template>
    <template #type-cell="{ row }">
      {{ row.original.type.name }}
      <span class="block text-xs text-muted">{{ t('hrWarnings.severity', { severity: row.original.type.severity }) }}</span>
    </template>
    <template #date_issued-cell="{ row }"><span class="tabular-nums">{{ formatDate(row.original.date_issued) }}</span></template>
    <template #state-cell="{ row }">
      <SharedStatusBadge size="sm" :tone="badge(row.original).tone" :label="badge(row.original).label" data-testid="hr-warning-state" />
      <span v-if="row.original.ack_pending" class="block text-xs text-muted">{{ t('hrWarnings.pendingAnswer') }}</span>
    </template>
    <template #mobile-row="{ row }">
      <div class="flex items-center justify-between gap-2">
        <bdi class="text-xs text-muted">#{{ row.id }}</bdi>
        <SharedStatusBadge size="sm" :tone="badge(row).tone" :label="badge(row).label" />
      </div>
      <p class="mt-1 font-semibold text-highlighted">{{ row.employee.name }}</p>
      <p class="mt-1 text-sm">{{ row.type.name }} · {{ formatDate(row.date_issued) }}</p>
      <p v-if="row.ack_pending" class="text-xs text-muted">{{ t('hrWarnings.pendingAnswer') }}</p>
    </template>
  </SharedDataTable>
</template>
