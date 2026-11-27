<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceTax } from '@liwan/contracts'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { h } from 'vue'
import { useArchiveSetupTax, useSetupTaxes } from '@/composables/finance/useFinanceRecords'
import RecordArchiveConfirm from './RecordArchiveConfirm.vue'
import RecordsFilters from './RecordsFilters.vue'
import { useRecordList } from './useRecordList'

// The taxes of the current company: search, sale or purchase, and archived filters in the URL, and a page of taxes.
// A tax is archived, never deleted; one that entries use keeps its rate.
const props = defineProps<{ background?: boolean }>()
const { t, n } = useI18n()
const { can } = useAccess()
const route = useRoute()
const canManage = computed(() => can('finance.taxes.manage'))
const USES = ['sale', 'purchase'] as const
const list = useRecordList<FinanceTax>({ fallbackPath: '/settings/apps/finance/taxes', background: () => props.background, kinds: USES, kindParam: 'type_tax_use', list: params => useSetupTaxes(params) })
const { mutateAsync: send, isPending: archiving } = useArchiveSetupTax()

const archivingItem = ref<FinanceTax | null>(null)
const kinds = computed(() => USES.map(value => ({ value, label: t(`financeRecords.taxes.uses.${value}`) })))

const columns = computed<TableColumn<FinanceTax>[]>(() => [
  { id: 'name', header: t('financeRecords.taxes.columns.name') },
  { id: 'type_tax_use', header: t('financeRecords.taxes.columns.use') },
  { id: 'amount', header: t('financeRecords.taxes.columns.amount') },
  { id: 'tax_account', header: t('financeRecords.taxes.columns.taxAccount') },
  { id: 'state', header: t('financeRecords.columns.state') },
  ...(canManage.value ? [{ id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } }] : []),
])
const dash = computed(() => t('app.notAvailable'))
const amountLabel = (tax: FinanceTax) => tax.amount_type === 'percent' ? `${n(tax.amount)}%` : n(tax.amount)
const stateTone = (tax: FinanceTax) => tax.active ? 'success' : 'neutral'
const stateLabel = (tax: FinanceTax) => t(`financeRecords.states.${tax.active ? 'active' : 'archived'}`)
const actions = (tax: FinanceTax): RowAction[] => [
  { label: t('financeRecords.actions.edit'), icon: 'i-lucide-pencil', to: { path: `/settings/apps/finance/taxes/${tax.id}/edit`, query: returnToQuery(route.fullPath) } },
  { label: t(`financeRecords.actions.${tax.active ? 'archive' : 'unarchive'}`), icon: tax.active ? 'i-lucide-archive' : 'i-lucide-archive-restore', onSelect: () => { archivingItem.value = tax } },
]
</script>

<template>
  <div class="grid gap-(--liwan-gap-card)">
    <RecordArchiveConfirm
      v-if="archivingItem"
      :key="archivingItem.id"
      scope="taxes"
      :name="archivingItem.name"
      :active="archivingItem.active"
      :pending="archiving"
      :send="archive => send({ id: archivingItem!.id, archive })"
      @done="archivingItem = null"
      @cancel="archivingItem = null"
    />
    <SharedListCard data-testid="finance-record-taxes">
      <template #filters>
        <RecordsFilters
          id-prefix="finance-record-taxes" :filters="list.filters.value" :active-count="list.activeCount.value" :hydrated="list.hydrated.value"
          :search="list.search.value" :search-placeholder="t('financeRecords.taxes.search')" :kinds="kinds" :kind-label="t('financeRecords.taxes.columns.use')" :all-label="t('financeRecords.taxes.allUses')"
          @update:search="value => { list.search.value = value }" @submit="list.submitSearch" @clear="list.clearFilters" @kind="list.setKind" @state="list.setState"
        />
      </template>
      <SharedPageState :error="list.query.error.value" :keep-content="list.items.value.length > 0" @retry="list.query.refetch">
        <SharedEmptyState v-if="list.showEmpty.value" :icon="list.activeCount.value ? 'i-lucide-filter-x' : 'i-lucide-percent'" class="m-(--liwan-card-pad-dense)" :title="t(list.activeCount.value ? 'app.noResults' : 'financeRecords.taxes.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,640px)]">
          <SharedDataTable bare :rows="list.items.value" :columns="columns" row-key="id" :loading="list.query.isPending.value" :caption="t('financeRecords.taxes.title')">
            <template #name-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.name }}</span></template>
            <template #type_tax_use-cell="{ row }"><SharedStatusBadge size="sm" tone="neutral" :label="t(`financeRecords.taxes.uses.${row.original.type_tax_use}`)" /></template>
            <template #amount-cell="{ row }"><bdi class="tabular-nums" dir="ltr">{{ amountLabel(row.original) }}</bdi></template>
            <template #tax_account-cell="{ row }">{{ row.original.tax_account?.name ?? dash }}</template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="stateTone(row.original)" :label="stateLabel(row.original)" /></template>
            <template #actions-cell="{ row }">
              <SharedRowActions :actions="actions(row.original)" :label="t('financeRecords.taxes.actionsNamed', { name: row.original.name })" :disabled="!list.hydrated.value || archivingItem !== null" />
            </template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 items-start justify-between gap-2" :data-testid="`finance-record-tax-${row.id}`">
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="truncate font-semibold text-highlighted">{{ row.name }}</span>
                  <span class="text-sm text-muted">{{ t(`financeRecords.taxes.uses.${row.type_tax_use}`) }} · <bdi class="tabular-nums" dir="ltr">{{ amountLabel(row) }}</bdi></span>
                  <SharedStatusBadge size="sm" class="w-fit" :tone="stateTone(row)" :label="stateLabel(row)" />
                </div>
                <SharedRowActions v-if="canManage" :actions="actions(row)" :label="t('financeRecords.taxes.actionsNamed', { name: row.name })" :disabled="!list.hydrated.value || archivingItem !== null" />
              </div>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <template v-if="list.query.data.value && !list.showEmpty.value" #footer>
        <SharedListFooter :count-label="t('financeRecords.taxes.footer', { shown: list.items.value.length, total: list.total.value }, list.total.value)" :page="list.filters.value.page" :pages="list.pages.value" :disabled="!list.hydrated.value || list.query.isFetching.value" count-test-id="finance-record-tax-count" @update:page="list.setPage" />
      </template>
    </SharedListCard>
  </div>
</template>
