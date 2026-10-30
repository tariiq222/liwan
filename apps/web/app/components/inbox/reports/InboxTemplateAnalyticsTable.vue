<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { InboxTemplateAnalyticsRow } from '@liwan/contracts'
import { TEMPLATE_CATEGORY_TONE } from '@/composables/inbox/inboxTemplate'
import { formatAmount, formatRatio, shareOf } from '@/composables/inbox/inboxReportCharts'

// Meta's counts per template beside our own sends and failures. Delivered and read are shown as a share of what was sent.
const props = defineProps<{ rows: readonly InboxTemplateAnalyticsRow[]; currency: string | null; loading?: boolean; error?: unknown; detailQuery: Record<string, string> }>()
const emit = defineEmits<{ retry: [] }>()
const { t, locale } = useI18n()
const count = computed(() => new Intl.NumberFormat(locale.value))

type Row = InboxTemplateAnalyticsRow
const numeric = (id: string, header: string): TableColumn<Row> => ({ id, header, meta: { class: { th: 'text-start whitespace-nowrap', td: 'whitespace-nowrap tabular-nums' } } as TableColumn<Row>['meta'] })
const columns = computed<TableColumn<Row>[]>(() => [
  { id: 'template', header: t('inbox.reports.templates.cols.template'), meta: { class: { th: 'text-start min-w-56', td: 'max-w-0' } } as TableColumn<Row>['meta'] },
  numeric('sent', t('inbox.reports.templates.cols.sent')),
  numeric('delivered', t('inbox.reports.templates.cols.delivered')),
  numeric('read', t('inbox.reports.templates.cols.read')),
  numeric('clicked', t('inbox.reports.templates.cols.clicked')),
  numeric('spent', t('inbox.reports.templates.cols.spent')),
  numeric('liwanSent', t('inbox.reports.templates.cols.liwanSent')),
  numeric('liwanFailed', t('inbox.reports.templates.cols.liwanFailed')),
])
const share = (part: number, whole: number) => formatRatio(shareOf(part, whole), locale.value)
const rowTo = (row: Row) => ({ path: `/inbox/reports/templates/${row.template.id}`, query: props.detailQuery })
</script>

<template>
  <SharedRecordSection variant="list" :title="t('inbox.reports.templates.title')" :description="t('inbox.reports.templates.hint')" data-testid="inbox-template-analytics">
    <SharedPageState v-if="error" class="m-4" :error="error" @retry="emit('retry')" />
    <SharedLoadingSkeleton v-else-if="loading" class="m-4" />
    <SharedEmptyState v-else-if="!rows.length" bordered class="m-4" :title="t('inbox.reports.templates.empty')" :description="t('inbox.reports.templates.emptyHint')" />
    <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,900px)]">
      <SharedDataTable bare :rows="[...rows]" :columns="columns" :row-key="(row: Row) => row.template.id" :caption="t('inbox.reports.templates.caption')">
        <template #template-cell="{ row }">
          <NuxtLink :to="rowTo(row.original)" class="flex min-w-0 flex-col gap-1 rounded focus-visible:outline-2 focus-visible:outline-primary" :data-testid="`inbox-template-analytics-${row.original.template.id}`">
            <span class="truncate text-sm font-medium text-highlighted"><bdi dir="ltr">{{ row.original.template.name }}</bdi></span>
            <span class="flex flex-wrap items-center gap-2 text-xs text-muted">
              <bdi dir="ltr">{{ row.original.template.language }}</bdi>
              <SharedStatusBadge size="sm" :tone="TEMPLATE_CATEGORY_TONE[row.original.template.category]" :label="t(`inbox.templates.category.${row.original.template.category}`)" />
            </span>
          </NuxtLink>
        </template>
        <template #sent-cell="{ row }">{{ count.format(row.original.sent) }}</template>
        <template #delivered-cell="{ row }">{{ count.format(row.original.delivered) }} <span class="text-muted">({{ share(row.original.delivered, row.original.sent) }})</span></template>
        <template #read-cell="{ row }">{{ count.format(row.original.read) }} <span class="text-muted">({{ share(row.original.read, row.original.sent) }})</span></template>
        <template #clicked-cell="{ row }">{{ count.format(row.original.clicked) }}</template>
        <template #spent-cell="{ row }">{{ formatAmount(row.original.amount_spent, currency, locale) }}</template>
        <template #liwanSent-cell="{ row }">{{ count.format(row.original.liwan_sent) }}</template>
        <template #liwanFailed-cell="{ row }"><span :class="row.original.liwan_failed > 0 ? 'text-error' : ''">{{ count.format(row.original.liwan_failed) }}</span></template>
        <template #mobile-row="{ row }">
          <NuxtLink :to="rowTo(row)" class="flex min-w-0 flex-col gap-1">
            <span class="truncate font-semibold text-highlighted"><bdi dir="ltr">{{ row.template.name }}</bdi></span>
            <span class="text-sm text-muted">{{ t('inbox.reports.templates.cols.sent') }} {{ count.format(row.sent) }} · {{ t('inbox.reports.templates.cols.delivered') }} {{ share(row.delivered, row.sent) }} · {{ t('inbox.reports.templates.cols.read') }} {{ share(row.read, row.sent) }}</span>
          </NuxtLink>
        </template>
      </SharedDataTable>
    </div>
  </SharedRecordSection>
</template>
