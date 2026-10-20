<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceAgedPartnerBalance } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import { amountColumn } from './reportColumns'
import { AGED_BUCKETS, agedRows, type AgedRow } from './reportRows'
import ReportMobileRow from './ReportMobileRow.vue'
import ReportTotals from './ReportTotals.vue'

// Open balances per account and, under each, per partner, in the report's age buckets.
const props = defineProps<{ report: FinanceAgedPartnerBalance }>()
const { t } = useI18n()
const rows = computed(() => agedRows(props.report))
const bucketLabel = (bucket: (typeof AGED_BUCKETS)[number]) => t(`financeReports.buckets.${bucket}`)
const columns = computed<TableColumn<AgedRow>[]>(() => [
  { id: 'name', header: t('financeReports.columns.partnerOrAccount') },
  ...AGED_BUCKETS.map(bucket => amountColumn<AgedRow>(bucket, bucketLabel(bucket))),
])
const partnerName = (row: AgedRow) => row.name ?? t('financeReports.noPartner')
const totals = computed(() => AGED_BUCKETS.map(bucket => ({ label: bucketLabel(bucket), amount: props.report.totals[bucket], currency: props.report.currency })))
const figures = (row: AgedRow) => AGED_BUCKETS.map(bucket => ({ label: bucketLabel(bucket), amount: row.buckets[bucket] }))
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,960px)]">
    <SharedDataTable bare :rows="rows" :columns="columns" row-key="key" :empty-text="t('financeReports.empty')" :caption="t('financeReports.reports.agedPartnerBalance.title')">
      <template #name-cell="{ row }">
        <span v-if="row.original.kind === 'account'" class="font-semibold text-highlighted"><bdi class="tabular-nums">{{ row.original.code }}</bdi> {{ row.original.name }}</span>
        <span v-else class="ps-6">{{ partnerName(row.original) }}</span>
      </template>
      <template v-for="bucket in AGED_BUCKETS" :key="bucket" #[`${bucket}-cell`]="{ row }">
        <span :class="row.original.kind === 'account' ? 'font-semibold' : ''"><Money :amount="row.original.buckets[bucket]" /></span>
      </template>
      <template #mobile-row="{ row }"><ReportMobileRow :title="row.kind === 'account' ? row.name : partnerName(row)" :subtitle="row.kind === 'account' ? row.code : undefined" :figures="figures(row)" /></template>
      <template #footer><ReportTotals :items="totals" /></template>
    </SharedDataTable>
  </div>
</template>
