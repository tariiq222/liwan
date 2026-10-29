<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { InboxReportBreakdownRow } from '@webvue/contracts'
import type { TableSort } from '@webvue/ui/app/utils/dataTable'
import { durationUnits, formatDuration, formatRatio } from '@/composables/inbox/inboxReportCharts'

// The agent table of the overview: resolved conversations, response times and satisfaction per agent, sortable here (the
// server returns the whole breakdown at once, largest resolved count first) and exportable as CSV.
const props = defineProps<{ rows: readonly InboxReportBreakdownRow[]; loading?: boolean; error?: unknown; exporting?: boolean }>()
const emit = defineEmits<{ export: []; retry: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const units = computed(() => durationUnits(t))
const count = computed(() => new Intl.NumberFormat(locale.value))

type Row = InboxReportBreakdownRow
const SORT_VALUE: Record<string, (row: Row) => number | null> = {
  resolved: row => row.metrics.conversations_resolved,
  responses: row => row.metrics.first_response.count,
  firstResponse: row => row.metrics.first_response.average_seconds,
  resolution: row => row.metrics.resolution.average_seconds,
  csat: row => row.metrics.csat.score,
  out: row => row.metrics.messages_out,
}
const sort = ref<TableSort | null>(null)
const sorted = computed(() => {
  const current = sort.value
  const value = current ? SORT_VALUE[current.column] : undefined
  if (!current || !value) return [...props.rows]
  const sign = current.direction === 'asc' ? 1 : -1
  // A row without a value (no answers yet) always sits last, whatever the direction.
  return [...props.rows].sort((a, b) => {
    const left = value(a)
    const right = value(b)
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1
    return (left - right) * sign
  })
})

const numeric = (id: string, header: string, sortable = true): TableColumn<Row> => ({
  id, header, meta: { sortable, class: { th: 'text-start whitespace-nowrap', td: 'whitespace-nowrap tabular-nums' } } as TableColumn<Row>['meta'],
})
const columns = computed<TableColumn<Row>[]>(() => [
  { id: 'index', header: t('inbox.reports.agents.cols.index'), meta: { class: { th: 'text-start w-12', td: 'w-12 text-muted tabular-nums' } } as TableColumn<Row>['meta'] },
  { id: 'agent', header: t('inbox.reports.agents.cols.agent'), meta: { class: { th: 'text-start min-w-48', td: 'max-w-0' } } as TableColumn<Row>['meta'] },
  numeric('resolved', t('inbox.reports.agents.cols.resolved')),
  numeric('responses', t('inbox.reports.agents.cols.responses')),
  numeric('firstResponse', t('inbox.reports.agents.cols.firstResponse')),
  numeric('resolution', t('inbox.reports.agents.cols.resolution')),
  numeric('csat', t('inbox.reports.agents.cols.csat')),
  numeric('out', t('inbox.reports.agents.cols.out')),
])
const indexOf = (row: Row) => sorted.value.indexOf(row) + 1
const name = (row: Row) => row.subject?.name ?? t('inbox.reports.agents.unassigned')
</script>

<template>
  <SharedRecordSection variant="list" :title="t('inbox.reports.agents.title')" :description="t('inbox.reports.agents.description')" data-testid="inbox-agent-table">
    <template #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-download" :loading="exporting" :disabled="!hydrated || exporting || !rows.length" :label="t('inbox.reports.agents.export')" data-testid="inbox-report-export" @click="emit('export')" />
    </template>
    <SharedPageState v-if="error" class="m-4" :error="error" @retry="emit('retry')" />
    <SharedLoadingSkeleton v-else-if="loading" class="m-4" />
    <SharedEmptyState v-else-if="!rows.length" bordered class="m-4" :title="t('inbox.reports.agents.empty')" :description="t('inbox.reports.agents.emptyHint')" />
    <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,820px)]">
      <SharedDataTable
        bare :rows="sorted" :columns="columns" :row-key="(row: Row) => row.subject?.id ?? 0" :caption="t('inbox.reports.agents.caption')"
        :sort="sort" @update:sort="sort = $event"
      >
        <template #index-cell="{ row }">{{ count.format(indexOf(row.original)) }}</template>
        <template #agent-cell="{ row }">
          <span class="flex min-w-0 items-center gap-2">
            <SharedPersonAvatar v-if="row.original.subject" :people="[row.original.subject]" />
            <span class="truncate text-sm font-medium text-highlighted"><bdi>{{ name(row.original) }}</bdi></span>
          </span>
        </template>
        <template #resolved-cell="{ row }">{{ count.format(row.original.metrics.conversations_resolved) }}</template>
        <template #responses-cell="{ row }">{{ count.format(row.original.metrics.first_response.count) }}</template>
        <template #firstResponse-cell="{ row }">{{ formatDuration(row.original.metrics.first_response.average_seconds, units, locale) }}</template>
        <template #resolution-cell="{ row }">{{ formatDuration(row.original.metrics.resolution.average_seconds, units, locale) }}</template>
        <template #csat-cell="{ row }">{{ formatRatio(row.original.metrics.csat.score, locale) }}</template>
        <template #out-cell="{ row }">{{ count.format(row.original.metrics.messages_out) }}</template>
        <template #mobile-row="{ row }">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="flex min-w-0 items-center gap-2">
              <SharedPersonAvatar v-if="row.subject" :people="[row.subject]" />
              <span class="truncate font-semibold text-highlighted"><bdi>{{ name(row) }}</bdi></span>
            </span>
            <span class="text-sm text-muted">{{ t('inbox.reports.agents.cols.resolved') }} {{ count.format(row.metrics.conversations_resolved) }} · {{ t('inbox.reports.agents.cols.firstResponse') }} {{ formatDuration(row.metrics.first_response.average_seconds, units, locale) }} · {{ t('inbox.reports.agents.cols.csat') }} {{ formatRatio(row.metrics.csat.score, locale) }}</span>
          </div>
        </template>
      </SharedDataTable>
    </div>
  </SharedRecordSection>
</template>
