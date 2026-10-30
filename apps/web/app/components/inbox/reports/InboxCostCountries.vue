<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { InboxCostCountryRow } from '@liwan/contracts'
import { formatAmount } from '@/composables/inbox/inboxReportCharts'

// Volume and cost per destination country, largest volume first (the server's order).
const props = defineProps<{ rows: readonly InboxCostCountryRow[]; currency: string | null }>()
const { t, locale } = useI18n()
const count = computed(() => new Intl.NumberFormat(locale.value))
const countryName = computed(() => new Intl.DisplayNames(locale.value, { type: 'region' }))
const label = (code: string) => { try { return countryName.value.of(code) ?? code } catch { return code } }

type Row = InboxCostCountryRow
const columns = computed<TableColumn<Row>[]>(() => [
  { id: 'country', header: t('inbox.reports.costs.countries.country'), meta: { class: { th: 'text-start', td: 'max-w-0' } } as TableColumn<Row>['meta'] },
  { id: 'volume', header: t('inbox.reports.costs.countries.volume'), meta: { class: { th: 'text-start w-32', td: 'whitespace-nowrap tabular-nums' } } as TableColumn<Row>['meta'] },
  { id: 'cost', header: t('inbox.reports.costs.countries.cost'), meta: { class: { th: 'text-start w-40', td: 'whitespace-nowrap tabular-nums' } } as TableColumn<Row>['meta'] },
])
</script>

<template>
  <SharedRecordSection variant="list" :title="t('inbox.reports.costs.countries.title')" :description="t('inbox.reports.costs.countries.description')" data-testid="inbox-cost-countries">
    <SharedEmptyState v-if="!props.rows.length" bordered class="m-4" :title="t('inbox.reports.costs.countries.empty')" />
    <div v-else class="min-w-0 [&_table]:w-full">
      <SharedDataTable bare :rows="[...props.rows]" :columns="columns" row-key="country" :caption="t('inbox.reports.costs.countries.caption')">
        <template #country-cell="{ row }"><span class="truncate text-sm font-medium text-highlighted">{{ label(row.original.country) }} <bdi dir="ltr" class="text-muted">({{ row.original.country }})</bdi></span></template>
        <template #volume-cell="{ row }">{{ count.format(row.original.volume) }}</template>
        <template #cost-cell="{ row }">{{ formatAmount(row.original.cost, props.currency, locale) }}</template>
        <template #mobile-row="{ row }">
          <div class="flex items-center justify-between gap-3">
            <span class="truncate font-medium text-highlighted">{{ label(row.country) }}</span>
            <span class="text-sm text-muted tabular-nums">{{ count.format(row.volume) }} · {{ formatAmount(row.cost, props.currency, locale) }}</span>
          </div>
        </template>
      </SharedDataTable>
    </div>
  </SharedRecordSection>
</template>
