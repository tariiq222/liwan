<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceInvoice } from '@webvue/contracts'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { useFinanceInvoiceList, useFinancePartner } from '@/composables/finance/useFinanceInvoices'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import InvoiceKpiStrip from './InvoiceKpiStrip.vue'
import { INVOICE_KINDS, invoiceRecordPath, invoiceTitle, type FinanceMoveType } from './invoiceKinds'
import { listReturnTo, useListLocation } from './listLocation'
import {
  INVOICE_PAGE_SIZE,
  INVOICE_STATES,
  invoiceActiveFilterCount,
  invoiceFiltersFromQuery,
  invoiceListParams,
} from './invoiceListParams'
import { INVOICE_STATE_TONE, PAYMENT_STATE_TONE } from './invoiceTones'
import Money from './Money.vue'
import PartnerPicker from './PartnerPicker.vue'

// The card of the one list of the four document types (customer invoices, credit notes, vendor bills, vendor refunds):
// the type only changes the endpoint's `move_type`, the routes and the wording. The page owns the SharedListPage
// shell and heading (useInvoiceListPage). `background` is the list behind the create panel: it reads its filters from
// the panel's returnTo.
const props = defineProps<{ moveType: FinanceMoveType; background?: boolean }>()
const { t } = useI18n()
const { can } = useAccess()
const { shown: kpisShown } = useKpiVisibility()
const kind = computed(() => INVOICE_KINDS[props.moveType])
const allowed = computed(() => can('finance.invoices.read'))
const { hydrated, filterQuery, search, update } = useRouteListFilters({
  background: () => props.background,
  fallbackPath: () => kind.value.listPath,
  safeReturnTo: listReturnTo(kind.value.listPath),
})
const filters = computed(() => invoiceFiltersFromQuery(filterQuery.value))
const activeCount = computed(() => invoiceActiveFilterCount(filters.value))
const query = useFinanceInvoiceList(() => invoiceListParams(props.moveType, filters.value), allowed)
const partner = useFinancePartner(() => filters.value.partnerId)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / INVOICE_PAGE_SIZE)))
const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)

const listLocation = useListLocation(kind.value.listPath, props.background)
const recordTo = (invoice: FinanceInvoice) => ({ path: invoiceRecordPath(invoice.move_type, invoice.id), query: { returnTo: listLocation.value } })

const stateItems = computed(() => [
  { value: 'all', label: t('financeDocuments.filters.allStates') },
  ...INVOICE_STATES.map(state => ({ value: state, label: t(`financeDocuments.states.${state}`) })),
])
function clearFilters() {
  search.value = ''
  void update({ q: undefined, state: undefined, partner_id: undefined, date_from: undefined, date_to: undefined, page: undefined })
}
function setState(value: unknown) {
  void update({ state: value === 'all' ? undefined : String(value), page: undefined })
}
function setPartner(value: number | null) {
  void update({ partner_id: value ? String(value) : undefined, page: undefined })
}
function setDate(key: 'date_from' | 'date_to', value: string | null) {
  void update({ [key]: value ?? undefined, page: undefined })
}

const columns = computed<TableColumn<FinanceInvoice>[]>(() => [
  { id: 'record_number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { id: 'name', header: t('financeDocuments.columns.number') },
  { id: 'partner', header: t(`financeDocuments.kinds.${props.moveType}.partner`) },
  { id: 'invoice_date', header: t('financeDocuments.columns.date') },
  { id: 'invoice_date_due', header: t('financeDocuments.columns.dueDate') },
  { id: 'amount_total', header: t('financeDocuments.columns.total'), meta: { class: { th: 'text-end', td: 'text-end' } } },
  { id: 'amount_residual', header: t('financeDocuments.columns.residual'), meta: { class: { th: 'text-end', td: 'text-end' } } },
  { id: 'state', header: t('financeDocuments.columns.state') },
  { id: 'payment_state', header: t('financeDocuments.columns.paymentState') },
])
const dash = computed(() => t('app.notAvailable'))
const label = (invoice: FinanceInvoice) => invoiceTitle(invoice, t('financeDocuments.draftNumber'))
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('financeDocuments.forbidden')" />
  <div v-else class="webvue-page-stack">
    <InvoiceKpiStrip v-if="kpisShown" :move-type="moveType" :filters="filters" />
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="!!filters.state || !!filters.partnerId || !!filters.dateFrom || !!filters.dateTo" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('financeDocuments.filters.search')" :aria-label="t('financeDocuments.filters.search')" :disabled="!hydrated" />
            </form>
          </template>
          <SharedFilterField :label="t('financeDocuments.filters.state')" for="finance-filter-state">
            <USelect id="finance-filter-state" class="w-full md:w-44" :model-value="filters.state ?? 'all'" :items="stateItems" :disabled="!hydrated" @update:model-value="setState" />
          </SharedFilterField>
          <SharedFilterField :label="t(`financeDocuments.kinds.${moveType}.partner`)" for="finance-filter-partner">
            <PartnerPicker id="finance-filter-partner" class="md:w-56" :model-value="filters.partnerId" :kind="kind.partnerKind" :known="partner.data.value ? { id: partner.data.value.id, name: partner.data.value.name } : null" :placeholder="t('financeDocuments.filters.anyPartner')" @update:model-value="setPartner" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeDocuments.filters.dateFrom')" for="finance-filter-from">
            <SharedDateField id="finance-filter-from" :model-value="filters.dateFrom" :max-value="filters.dateTo" :disabled="!hydrated" @update:model-value="setDate('date_from', $event)" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeDocuments.filters.dateTo')" for="finance-filter-to">
            <SharedDateField id="finance-filter-to" :model-value="filters.dateTo" :min-value="filters.dateFrom" :disabled="!hydrated" @update:model-value="setDate('date_to', $event)" />
          </SharedFilterField>
        </SharedFilterBar>
      </template>
      <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(activeCount ? 'app.noResults' : `financeDocuments.kinds.${moveType}.empty`)" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,880px)]">
          <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="recordTo" :loading="query.isPending.value" :caption="t(`financeDocuments.kinds.${moveType}.title`)">
            <template #record_number-cell="{ row }"><SharedRecordNumber :value="row.original.id" /></template>
            <template #name-cell="{ row }">
              <NuxtLink :to="recordTo(row.original)" class="font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :data-testid="`finance-invoice-row-${row.original.id}`" @click="!hydrated && $event.preventDefault()"><bdi>{{ label(row.original) }}</bdi></NuxtLink>
            </template>
            <template #partner-cell="{ row }">{{ row.original.partner?.name ?? dash }}</template>
            <template #invoice_date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.invoice_date ?? dash }}</bdi></template>
            <template #invoice_date_due-cell="{ row }"><bdi class="tabular-nums">{{ row.original.invoice_date_due ?? dash }}</bdi></template>
            <template #amount_total-cell="{ row }"><Money :amount="row.original.amount_total" :currency="row.original.currency" /></template>
            <template #amount_residual-cell="{ row }"><Money v-if="row.original.state === 'posted'" :amount="row.original.amount_residual" :currency="row.original.currency" /><span v-else class="text-muted">{{ dash }}</span></template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="INVOICE_STATE_TONE[row.original.state]" :label="t(`financeDocuments.states.${row.original.state}`)" /></template>
            <template #payment_state-cell="{ row }">
              <SharedStatusBadge v-if="row.original.state === 'posted'" size="sm" :tone="PAYMENT_STATE_TONE[row.original.payment_state]" :label="t(`financeDocuments.paymentStates.${row.original.payment_state}`)" />
              <span v-else class="text-muted">{{ dash }}</span>
            </template>
            <template #mobile-row="{ row }">
              <NuxtLink :to="recordTo(row)" class="flex min-w-0 flex-col gap-2">
                <span class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-semibold text-highlighted"><bdi>{{ label(row) }}</bdi></span>
                  <SharedStatusBadge size="sm" :tone="INVOICE_STATE_TONE[row.state]" :label="t(`financeDocuments.states.${row.state}`)" />
                </span>
                <span class="truncate text-sm text-muted">{{ row.partner?.name ?? dash }}</span>
                <span class="flex items-center justify-between gap-2 text-sm">
                  <Money :amount="row.amount_total" :currency="row.currency" />
                  <SharedStatusBadge v-if="row.state === 'posted'" size="sm" :tone="PAYMENT_STATE_TONE[row.payment_state]" :label="t(`financeDocuments.paymentStates.${row.payment_state}`)" />
                </span>
              </NuxtLink>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <template v-if="query.data.value && !showEmpty" #footer>
        <SharedListFooter :count-label="t('financeDocuments.footer', { shown: items.length, total }, total)" :page="filters.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" count-test-id="finance-invoice-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
