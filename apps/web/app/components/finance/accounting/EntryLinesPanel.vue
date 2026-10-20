<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { JournalEntryDetail, JournalEntryLine } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import { entryTotals } from './entryLines'

// The lines of an entry and their totals, read-only.
const props = defineProps<{ entry: JournalEntryDetail }>()
const { t } = useI18n()
const numeric = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<JournalEntryLine>[]>(() => [
  { id: 'account', header: t('financeAccounting.form.account') },
  { id: 'partner', header: t('financeAccounting.form.partner') },
  { id: 'name', header: t('financeAccounting.form.lineName') },
  { id: 'debit', header: t('financeAccounting.form.debit'), meta: numeric },
  { id: 'credit', header: t('financeAccounting.form.credit'), meta: numeric },
])
const totals = computed(() => entryTotals(props.entry.lines.map(line => ({ debit: String(line.debit), credit: String(line.credit) }))))
const dash = computed(() => t('app.notAvailable'))
</script>

<template>
  <SharedRecordSection variant="list" :title="t('financeAccounting.form.lines')" data-testid="finance-entry-lines-panel">
    <SharedDataTable bare :rows="entry.lines" :columns="columns" row-key="id" :caption="t('financeAccounting.form.lines')">
      <template #account-cell="{ row }">{{ row.original.account.name }}</template>
      <template #partner-cell="{ row }">{{ row.original.partner?.name ?? dash }}</template>
      <template #name-cell="{ row }">{{ row.original.name }}</template>
      <template #debit-cell="{ row }"><Money v-if="row.original.debit > 0" :amount="row.original.debit" /><span v-else class="text-muted">{{ dash }}</span></template>
      <template #credit-cell="{ row }"><Money v-if="row.original.credit > 0" :amount="row.original.credit" /><span v-else class="text-muted">{{ dash }}</span></template>
      <template #mobile-row="{ row }">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-semibold text-highlighted">{{ row.account.name }}</p>
            <p class="text-sm text-muted">{{ row.name }}</p>
          </div>
          <Money :amount="row.debit > 0 ? row.debit : row.credit" :currency="entry.currency" />
        </div>
      </template>
    </SharedDataTable>
    <dl class="ms-auto grid w-full max-w-sm gap-2 border-t border-default p-(--webvue-card-pad) text-sm font-semibold text-highlighted" data-testid="finance-entry-totals">
      <div class="flex items-center justify-between gap-4">
        <dt>{{ t('financeAccounting.form.totalDebit') }}</dt>
        <dd><Money :amount="totals.debit" :currency="entry.currency" /></dd>
      </div>
      <div class="flex items-center justify-between gap-4">
        <dt>{{ t('financeAccounting.form.totalCredit') }}</dt>
        <dd><Money :amount="totals.credit" :currency="entry.currency" /></dd>
      </div>
    </dl>
  </SharedRecordSection>
</template>
