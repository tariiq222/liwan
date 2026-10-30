<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceFiscalYear } from '@liwan/contracts'
import Money from '../invoices/Money.vue'
import { CLOSING_HASH, CLOSING_PATH, FISCAL_YEAR_STATE_TONE } from './closingPresentation'

// The fiscal years of the company: state, result and the closing entry. An open year opens its preview via ?year=.
defineProps<{ years: FinanceFiscalYear[]; currency?: string; selected: number | null }>()
const { t } = useI18n()
const hydrated = useHydrated()

const previewTo = (year: number) => ({ path: CLOSING_PATH, query: { year: String(year) }, hash: CLOSING_HASH })
const resultClass = (value: number) => value < 0 ? 'text-error' : value > 0 ? 'text-success' : 'text-muted'
const entryTo = (id: number) => `/finance/accounting/entries/${id}`
const numeric = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<FinanceFiscalYear>[]>(() => [
  { id: 'year', header: t('financeGovernance.closing.columns.year') },
  { id: 'period', header: t('financeGovernance.closing.columns.period') },
  { id: 'state', header: t('financeGovernance.closing.columns.state') },
  { id: 'result', header: t('financeGovernance.closing.columns.result'), meta: numeric },
  { id: 'entry', header: t('financeGovernance.closing.columns.entry') },
  { id: 'preview', header: t('financeGovernance.closing.columns.preview') },
])
</script>

<template>
  <SharedRecordSection variant="list" :title="t('financeGovernance.closing.yearsTitle')" :description="t('financeGovernance.closing.yearsHint')" data-testid="finance-closing-years">
    <SharedDataTable bare :rows="years" :columns="columns" row-key="year" :caption="t('financeGovernance.closing.yearsTitle')">
      <template #year-cell="{ row }"><bdi class="font-semibold tabular-nums text-highlighted">{{ row.original.year }}</bdi></template>
      <template #period-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date_from }} → {{ row.original.date_to }}</bdi></template>
      <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="FISCAL_YEAR_STATE_TONE[row.original.state]" :label="t(`financeGovernance.closing.states.${row.original.state}`)" /></template>
      <template #result-cell="{ row }"><Money :class="resultClass(row.original.result)" :amount="row.original.result" :currency="currency" /></template>
      <template #entry-cell="{ row }">
        <NuxtLink v-if="row.original.closing_entry" :to="entryTo(row.original.closing_entry.id)" class="text-primary hover:underline"><bdi>{{ row.original.closing_entry.name }}</bdi></NuxtLink>
        <span v-else class="text-muted">{{ t('app.notAvailable') }}</span>
      </template>
      <template #preview-cell="{ row }">
        <UButton v-if="row.original.state === 'open'" size="xs" variant="soft" :color="selected === row.original.year ? 'primary' : 'neutral'" icon="i-lucide-eye" :to="previewTo(row.original.year)" :disabled="!hydrated" :label="t('financeGovernance.closing.preview.open')" :data-testid="`finance-closing-open-${row.original.year}`" />
      </template>
      <template #mobile-row="{ row }">
        <div class="flex min-w-0 flex-col gap-2">
          <span class="flex items-center justify-between gap-2">
            <bdi class="font-semibold tabular-nums text-highlighted">{{ row.year }}</bdi>
            <SharedStatusBadge size="sm" :tone="FISCAL_YEAR_STATE_TONE[row.state]" :label="t(`financeGovernance.closing.states.${row.state}`)" />
          </span>
          <bdi class="text-sm tabular-nums text-muted">{{ row.date_from }} → {{ row.date_to }}</bdi>
          <span class="flex items-center justify-between gap-2 text-sm">
            <span class="text-muted">{{ t('financeGovernance.closing.columns.result') }}</span>
            <Money :class="resultClass(row.result)" :amount="row.result" :currency="currency" />
          </span>
          <NuxtLink v-if="row.closing_entry" :to="entryTo(row.closing_entry.id)" class="text-sm text-primary hover:underline"><bdi>{{ row.closing_entry.name }}</bdi></NuxtLink>
          <UButton v-if="row.state === 'open'" size="xs" variant="soft" :color="selected === row.year ? 'primary' : 'neutral'" icon="i-lucide-eye" :to="previewTo(row.year)" :disabled="!hydrated" :label="t('financeGovernance.closing.preview.open')" />
        </div>
      </template>
    </SharedDataTable>
  </SharedRecordSection>
</template>
