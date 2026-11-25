<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { HelpdeskTicketRow } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { HELPDESK_PRIORITY_TONE, HELPDESK_SLA_TONE } from './helpdeskStatus'

// The rows of the support list. The page owns the query, filters and paging; this renders the loaded page.
const props = defineProps<{
  rows: HelpdeskTicketRow[]
  loading: boolean
  error: unknown
  recordTo: (ticket: HelpdeskTicketRow) => RouteLocationRaw
}>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()

const SUBJECT_LINK = 'block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
function column(id: string, header: string, width: string, fit = true, title = false): TableColumn<HelpdeskTicketRow> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return {
    id,
    header,
    meta: {
      ...(title ? { title: true } : {}),
      class: { th: `text-start ${width}`, td: `${title ? 'max-w-0' : cell} ${width}` },
    } as TableColumn<HelpdeskTicketRow>['meta'],
  }
}
const columns = computed<TableColumn<HelpdeskTicketRow>[]>(() => [
  column('subject', t('helpdesk.columns.subject'), 'min-w-[260px]', false, true),
  column('requester', t('helpdesk.columns.requester'), 'w-[168px] min-w-[168px]', false),
  column('stage', t('helpdesk.columns.stage'), 'w-[132px] min-w-[132px]'),
  column('priority', t('helpdesk.columns.priority'), 'w-[104px] min-w-[104px]'),
  column('assignee', t('helpdesk.columns.assignee'), 'w-[160px] min-w-[160px]', false),
  column('sla', t('helpdesk.columns.sla'), 'w-[136px] min-w-[136px]'),
  column('created', t('helpdesk.columns.created'), 'w-[120px] min-w-[120px]'),
])
const slaLabel = (row: HelpdeskTicketRow) => row.sla.state === 'none' ? t('helpdesk.sla.none') : t(`helpdesk.sla.${row.sla.state}`, { date: row.sla.deadline ? formatDate(row.sla.deadline) : '' })
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,1080px)] [&_table]:table-fixed">
    <SharedDataTable bare :rows="props.rows" :columns="columns" row-key="id" :row-to="props.recordTo" :loading="props.loading" :error="props.error" :caption="t('helpdesk.title')" @retry="emit('retry')">
      <template #subject-cell="{ row }">
        <NuxtLink :to="props.recordTo(row.original)" :class="SUBJECT_LINK" data-testid="helpdesk-ticket-link">{{ row.original.subject }}</NuxtLink>
        <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <SharedRecordNumber :value="row.original.number" />
        </div>
      </template>
      <template #requester-cell="{ row }">{{ row.original.requester.name }}</template>
      <template #stage-cell="{ row }">
        <SharedStatusBadge :tone="row.original.stage.closed ? 'neutral' : 'info'" :label="row.original.stage.name" size="sm" />
      </template>
      <template #priority-cell="{ row }">
        <SharedStatusBadge :tone="HELPDESK_PRIORITY_TONE[row.original.priority]" :label="t(`helpdesk.priority.${row.original.priority}`)" size="sm" />
      </template>
      <template #assignee-cell="{ row }">{{ row.original.assignee?.name ?? t('helpdesk.unassigned') }}</template>
      <template #sla-cell="{ row }">
        <SharedStatusBadge v-if="row.original.sla.state !== 'none'" :tone="HELPDESK_SLA_TONE[row.original.sla.state]" :label="slaLabel(row.original)" size="sm" />
        <span v-else class="text-sm text-muted">—</span>
      </template>
      <template #created-cell="{ row }"><bdi dir="ltr">{{ formatDate(row.original.created_at) }}</bdi></template>
      <template #mobile-row="{ row }">
        <NuxtLink :to="props.recordTo(row)" class="flex min-w-0 flex-col gap-1">
          <span class="flex min-w-0 items-center justify-between gap-2">
            <span class="min-w-0 truncate font-semibold text-highlighted">{{ row.subject }}</span>
            <SharedStatusBadge :tone="row.stage.closed ? 'neutral' : 'info'" :label="row.stage.name" size="sm" class="shrink-0" />
          </span>
          <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
            <SharedRecordNumber :value="row.number" />
            <span class="truncate">{{ row.requester.name }} · {{ row.assignee?.name ?? t('helpdesk.unassigned') }}</span>
          </span>
        </NuxtLink>
      </template>
    </SharedDataTable>
  </div>
</template>
