<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceVatReturn } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import { amountColumn } from './reportColumns'
import ReportMobileRow from './ReportMobileRow.vue'
import VatReturnItems from './VatReturnItems.vue'

// The boxes of the Saudi VAT return, in the return's order, as management figures for a person to review: the return is filed
// by the taxpayer on the ZATCA portal, never from here. A figure that comes from the books opens the journal items behind it.
type Box = FinanceVatReturn['boxes'][number]
const props = defineProps<{ report: FinanceVatReturn }>()
const { t, te } = useI18n()
const open = ref<{ code: string; column: 'base' | 'tax' } | null>(null)
const columns = computed<TableColumn<Box>[]>(() => [
  { id: 'number', header: t('financeReports.vatReturn.box') },
  { id: 'name', header: t('financeReports.columns.item') },
  amountColumn('base', t('financeReports.columns.base')),
  amountColumn('tax', t('financeReports.columns.taxAmount')),
])
const name = (box: Box) => te(`financeReports.vatReturn.boxes.${box.code}`) ? t(`financeReports.vatReturn.boxes.${box.code}`) : box.name
const isOpen = (box: Box, column: 'base' | 'tax') => open.value?.code === box.code && open.value.column === column
function toggle(box: Box, column: 'base' | 'tax') { open.value = isOpen(box, column) ? null : { code: box.code, column } }
const openBox = computed(() => props.report.boxes.find(box => box.code === open.value?.code))
watch(() => [props.report.date_from, props.report.date_to], () => { open.value = null })
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,560px)]">
    <UAlert color="warning" variant="subtle" icon="i-lucide-triangle-alert" class="m-(--webvue-card-pad-dense) w-auto" :title="t('financeReports.vatReturn.noticeTitle')" :description="t('financeReports.vatReturn.notice')" data-testid="finance-vat-return-notice" />
    <SharedDataTable bare :rows="report.boxes" :columns="columns" row-key="code" :empty-text="t('financeReports.empty')" :caption="t('financeReports.reports.vatReturn.title')">
      <template #number-cell="{ row }"><bdi class="tabular-nums text-muted">{{ row.original.number }}</bdi></template>
      <template #name-cell="{ row }">{{ name(row.original) }}</template>
      <template v-for="column in (['base', 'tax'] as const)" :key="column" #[`${column}-cell`]="{ row }">
        <UButton v-if="row.original[column] !== null" color="neutral" variant="link" size="sm" class="tabular-nums" :aria-expanded="isOpen(row.original, column)" :aria-label="t('financeReports.vatReturn.openItems', { box: row.original.number })" :data-testid="`finance-vat-return-${row.original.code}-${column}`" @click="toggle(row.original, column)">
          <Money :amount="row.original[column]" :currency="report.currency" />
        </UButton>
      </template>
      <template #mobile-row="{ row }">
        <ReportMobileRow :title="`${row.number}. ${name(row)}`" :figures="[
          ...(row.base !== null ? [{ label: t('financeReports.columns.base'), amount: row.base, currency: report.currency }] : []),
          ...(row.tax !== null ? [{ label: t('financeReports.columns.taxAmount'), amount: row.tax, currency: report.currency }] : []),
        ]" />
      </template>
    </SharedDataTable>
    <VatReturnItems v-if="open && openBox" :key="`${open.code}-${open.column}`" :box="openBox" :column="open.column" :date-from="report.date_from" :date-to="report.date_to" :currency="report.currency" @close="open = null" />
  </div>
</template>
