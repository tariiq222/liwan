<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinancePayment } from '@webvue/contracts'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { useFinancePartner } from '@/composables/finance/useFinancePartners'
import { useFinancePaymentTransition, useFinancePayments } from '@/composables/finance/useFinancePayments'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import { financeErrorMessage } from '../financeErrors'
import { financeErrorKey } from '../invoices/invoiceErrors'
import { listReturnTo } from '../invoices/listLocation'
import Money from '../invoices/Money.vue'
import PartnerPicker from '../invoices/PartnerPicker.vue'
import {
  PAYMENT_PAGE_SIZE,
  PAYMENTS_PATH,
  PAYMENT_STATE_TONE,
  PAYMENT_STATES,
  PAYMENT_TYPES,
  paymentActions,
  paymentActiveFilterCount,
  paymentFiltersFromQuery,
  paymentListParams,
} from './paymentModel'

// The card of the payments list. A payment is created from the documents it pays (the create panel), and a live one
// can be cancelled while a cancelled or rejected one is reset to draft; both ask inline first. The page owns the
// SharedListPage shell and heading (usePaymentListPage). `background` is the list behind the create panel: it reads its
// filters from the panel's returnTo.
const props = defineProps<{ background?: boolean }>()
const { t } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('finance.payments.read'))
const { hydrated, filterQuery, search, update } = useRouteListFilters({
  background: () => props.background,
  fallbackPath: () => PAYMENTS_PATH,
  safeReturnTo: listReturnTo(PAYMENTS_PATH),
})
const filters = computed(() => paymentFiltersFromQuery(filterQuery.value))
const activeCount = computed(() => paymentActiveFilterCount(filters.value))
const query = useFinancePayments(() => paymentListParams(filters.value), allowed)
const partner = useFinancePartner(() => filters.value.partnerId)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAYMENT_PAGE_SIZE)))
const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)

const typeItems = computed(() => [{ value: 'all', label: t('financeDocuments.payments.allTypes') }, ...PAYMENT_TYPES.map(type => ({ value: type, label: t(`financeDocuments.payments.types.${type}`) }))])
const stateItems = computed(() => [{ value: 'all', label: t('financeDocuments.filters.allStates') }, ...PAYMENT_STATES.map(state => ({ value: state, label: t(`financeDocuments.payments.states.${state}`) }))])
const choose = (key: string) => (value: unknown) => update({ [key]: value === 'all' ? undefined : String(value), page: undefined })
function clearFilters() {
  search.value = ''
  void update({ q: undefined, payment_type: undefined, state: undefined, partner_id: undefined, date_from: undefined, date_to: undefined, page: undefined })
}

const transition = useFinancePaymentTransition()
const confirming = ref<{ payment: FinancePayment; action: 'cancel' | 'reset-to-draft' } | null>(null)
const actionError = ref('')
async function confirmTransition() {
  const pending = confirming.value
  if (!pending || !hydrated.value || transition.isPending.value) return
  actionError.value = ''
  try {
    await transition.mutateAsync({ id: pending.payment.id, action: pending.action })
    confirming.value = null
  } catch (cause) {
    actionError.value = financeErrorMessage(cause, financeErrorKey, t)
  }
}
const label = (payment: FinancePayment) => payment.name || `${t('financeDocuments.payments.draftNumber')} #${payment.id}`
function rowActions(payment: FinancePayment) {
  const set = paymentActions(payment, can)
  return [
    ...(set.resetToDraft ? [{ label: t('financeDocuments.payments.resetToDraft'), icon: 'i-lucide-undo-2' as const, onSelect: () => { confirming.value = { payment, action: 'reset-to-draft' } } }] : []),
    ...(set.cancel ? [{ label: t('financeDocuments.payments.cancel'), icon: 'i-lucide-ban' as const, destructive: true, onSelect: () => { confirming.value = { payment, action: 'cancel' } } }] : []),
  ]
}

const columns = computed<TableColumn<FinancePayment>[]>(() => [
  { id: 'record_number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { id: 'name', header: t('financeDocuments.columns.number') },
  { id: 'partner', header: t('financeDocuments.payments.partner') },
  { id: 'payment_type', header: t('financeDocuments.payments.type') },
  { id: 'journal', header: t('financeDocuments.record.journal') },
  { id: 'date', header: t('financeDocuments.columns.date') },
  { id: 'amount', header: t('financeDocuments.payments.amount'), meta: { class: { th: 'text-end', td: 'text-end' } } },
  { id: 'state', header: t('financeDocuments.columns.state') },
  { id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-12', td: 'w-12 text-end' } } },
])
const dash = computed(() => t('app.notAvailable'))
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('financeDocuments.forbidden')" />
  <div v-else class="webvue-page-stack">
    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" data-testid="finance-payment-action-error" />
    <SharedInlineConfirm
      v-if="confirming"
      :title="t(confirming.action === 'cancel' ? 'financeDocuments.payments.cancelConfirm' : 'financeDocuments.payments.resetConfirm', { name: label(confirming.payment) })"
      :description="t(confirming.action === 'cancel' ? 'financeDocuments.payments.cancelHint' : 'financeDocuments.payments.resetHint')"
      :confirm-label="t(confirming.action === 'cancel' ? 'financeDocuments.payments.cancel' : 'financeDocuments.payments.resetToDraft')"
      :color="confirming.action === 'cancel' ? 'error' : 'warning'"
      :pending="transition.isPending.value"
      :disabled="!hydrated"
      @confirm="confirmTransition"
      @cancel="confirming = null"
    />
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="!!filters.paymentType || !!filters.state || !!filters.partnerId || !!filters.dateFrom || !!filters.dateTo" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('financeDocuments.payments.search')" :aria-label="t('financeDocuments.payments.search')" :disabled="!hydrated" />
            </form>
          </template>
          <SharedFilterField :label="t('financeDocuments.payments.type')" for="finance-payment-filter-type">
            <USelect id="finance-payment-filter-type" class="w-full md:w-44" :model-value="filters.paymentType ?? 'all'" :items="typeItems" :disabled="!hydrated" @update:model-value="choose('payment_type')" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeDocuments.filters.state')" for="finance-payment-filter-state">
            <USelect id="finance-payment-filter-state" class="w-full md:w-44" :model-value="filters.state ?? 'all'" :items="stateItems" :disabled="!hydrated" @update:model-value="choose('state')" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeDocuments.payments.partner')" for="finance-payment-filter-partner">
            <PartnerPicker id="finance-payment-filter-partner" class="md:w-56" :model-value="filters.partnerId" kind="any" :known="partner.data.value ? { id: partner.data.value.id, name: partner.data.value.name } : null" :placeholder="t('financeDocuments.filters.anyPartner')" @update:model-value="value => update({ partner_id: value ? String(value) : undefined, page: undefined })" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeDocuments.filters.dateFrom')" for="finance-payment-filter-from">
            <SharedDateField id="finance-payment-filter-from" :model-value="filters.dateFrom" :max-value="filters.dateTo" :disabled="!hydrated" @update:model-value="value => update({ date_from: value ?? undefined, page: undefined })" />
          </SharedFilterField>
          <SharedFilterField :label="t('financeDocuments.filters.dateTo')" for="finance-payment-filter-to">
            <SharedDateField id="finance-payment-filter-to" :model-value="filters.dateTo" :min-value="filters.dateFrom" :disabled="!hydrated" @update:model-value="value => update({ date_to: value ?? undefined, page: undefined })" />
          </SharedFilterField>
        </SharedFilterBar>
      </template>
      <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(activeCount ? 'app.noResults' : 'financeDocuments.payments.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,820px)]">
          <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :loading="query.isPending.value" :caption="t('financeDocuments.payments.title')">
            <template #record_number-cell="{ row }"><SharedRecordNumber :value="row.original.id" /></template>
            <template #name-cell="{ row }"><span class="font-semibold text-highlighted" :data-testid="`finance-payment-row-${row.original.id}`"><bdi>{{ label(row.original) }}</bdi></span></template>
            <template #partner-cell="{ row }">{{ row.original.partner?.name ?? dash }}</template>
            <template #payment_type-cell="{ row }">{{ t(`financeDocuments.payments.types.${row.original.payment_type}`) }}</template>
            <template #journal-cell="{ row }">{{ row.original.journal.name }}</template>
            <template #date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date }}</bdi></template>
            <template #amount-cell="{ row }"><Money :amount="row.original.amount" :currency="row.original.currency" /></template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="PAYMENT_STATE_TONE[row.original.state]" :label="t(`financeDocuments.payments.states.${row.original.state}`)" /></template>
            <template #actions-cell="{ row }"><SharedRowActions :actions="rowActions(row.original)" :label="t('financeDocuments.payments.actionsFor', { name: label(row.original) })" :disabled="transition.isPending.value" /></template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 flex-col gap-2">
                <span class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-semibold text-highlighted"><bdi>{{ label(row) }}</bdi></span>
                  <SharedStatusBadge size="sm" :tone="PAYMENT_STATE_TONE[row.state]" :label="t(`financeDocuments.payments.states.${row.state}`)" />
                </span>
                <span class="truncate text-sm text-muted">{{ row.partner?.name ?? dash }} · {{ t(`financeDocuments.payments.types.${row.payment_type}`) }}</span>
                <span class="flex items-center justify-between gap-2 text-sm">
                  <Money :amount="row.amount" :currency="row.currency" />
                  <SharedRowActions :actions="rowActions(row)" :label="t('financeDocuments.payments.actionsFor', { name: label(row) })" :disabled="transition.isPending.value" />
                </span>
              </div>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <template v-if="query.data.value && !showEmpty" #footer>
        <SharedListFooter :count-label="t('financeDocuments.footer', { shown: items.length, total }, total)" :page="filters.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" count-test-id="finance-payment-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
