<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceVatReturn, FinanceVatReturnItem } from '@liwan/contracts'
import { useFinanceVatReturnItems, VAT_RETURN_ITEMS_PAGE_SIZE } from '@/composables/finance/useFinanceReports'
import Money from '../invoices/Money.vue'
import { amountColumn } from './reportColumns'

// The journal items behind one figure of a VAT return box, a page at a time. Each item's contribution is signed: it adds to the
// box when positive. The item's entry opens in the entries section.
const props = defineProps<{ box: FinanceVatReturn['boxes'][number]; column: 'base' | 'tax'; dateFrom: string; dateTo: string; currency: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const page = ref(1)
const query = useFinanceVatReturnItems(() => ({ code: props.box.code, column: props.column, page: page.value, dateFrom: props.dateFrom, dateTo: props.dateTo }))
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / VAT_RETURN_ITEMS_PAGE_SIZE)))
const columns = computed<TableColumn<FinanceVatReturnItem>[]>(() => [
  { id: 'date', header: t('financeReports.columns.date') },
  { id: 'entry', header: t('financeReports.columns.entry') },
  { id: 'account', header: t('financeReports.columns.account') },
  { id: 'label', header: t('financeReports.columns.label') },
  amountColumn('amount', t('financeReports.vatReturn.contribution')),
])
const dash = computed(() => t('app.notAvailable'))
</script>

<template>
  <div class="border-t border-default p-(--liwan-card-pad-dense)" data-testid="finance-vat-return-items">
    <div class="mb-2 flex items-center justify-between gap-2">
      <p class="font-semibold text-highlighted">{{ t('financeReports.vatReturn.itemsTitle', { box: box.number, column: t(`financeReports.vatReturn.columns.${column}`) }) }}</p>
      <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-x" :label="t('financeReports.vatReturn.close')" @click="emit('close')" />
    </div>
    <SharedPageState :loading="query.isPending.value" :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
      <SharedEmptyState v-if="!items.length" :title="t('financeReports.vatReturn.noItems')" />
      <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,640px)]">
        <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :caption="t('financeReports.vatReturn.itemsCaption')">
          <template #date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date }}</bdi></template>
          <template #entry-cell="{ row }">{{ row.original.entry?.name ?? dash }}</template>
          <template #account-cell="{ row }"><bdi dir="ltr">{{ row.original.account.code }}</bdi> {{ row.original.account.name }}</template>
          <template #label-cell="{ row }">{{ row.original.label }}<span v-if="row.original.partner" class="block text-xs text-muted">{{ row.original.partner.name }}</span></template>
          <template #amount-cell="{ row }"><Money :amount="row.original.amount" :currency="currency" /></template>
          <template #mobile-row="{ row }">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="truncate font-semibold text-highlighted">{{ row.entry?.name ?? dash }} · <bdi class="tabular-nums">{{ row.date }}</bdi></span>
              <span class="truncate text-sm text-muted">{{ row.account.code }} {{ row.account.name }}</span>
              <Money :amount="row.amount" :currency="currency" />
            </div>
          </template>
        </SharedDataTable>
      </div>
    </SharedPageState>
    <SharedListFooter v-if="total > 0" :count-label="t('financeReports.linesFooter', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="query.isFetching.value" count-test-id="finance-vat-return-item-count" @update:page="value => { page = value }" />
  </div>
</template>
