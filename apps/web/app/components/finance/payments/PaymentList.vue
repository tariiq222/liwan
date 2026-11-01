<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinancePayment } from '@liwan/contracts'
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { useFinancePartner } from '@/composables/finance/useFinancePartners'
import { useFinancePaymentPost, useFinancePaymentTransition, useFinancePaymentUnallocate, useFinancePayments } from '@/composables/finance/useFinancePayments'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import { offeredMenuItems, readFinanceActions } from '../financeActions'
import { financeErrorMessage } from '../financeErrors'
import FinanceBlockedNotice from '../FinanceBlockedNotice.vue'
import { financeErrorKey } from '../invoices/invoiceErrors'
import { listReturnTo } from '../invoices/listLocation'
import Money from '../invoices/Money.vue'
import PartnerPicker from '../invoices/PartnerPicker.vue'
import PaymentAllocate from './PaymentAllocate.vue'
import PaymentEditPanel from './PaymentEditPanel.vue'
import PaymentExchangeDifference from './PaymentExchangeDifference.vue'
import {
  PAYMENT_PAGE_SIZE,
  PAYMENTS_PATH,
  PAYMENT_STATE_TONE,
  PAYMENT_STATES,
  PAYMENT_TYPES,
  paymentActiveFilterCount,
  paymentFiltersFromQuery,
  paymentListParams,
  standalonePaymentLink,
  transferPaymentLink,
} from './paymentModel'

// The card of the payments list. A payment is created from the documents it pays (the create panel), and a live one
// can be cancelled while a cancelled or rejected one is reset to draft; both ask inline first. The page owns the
// SharedListPage shell and heading (usePaymentListPage). `background` is the list behind the create panel: it reads its
// filters from the panel's returnTo.
const props = defineProps<{ background?: boolean }>()
const { t } = useI18n()
const route = useRoute()
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
const unallocate = useFinancePaymentUnallocate()
const post = useFinancePaymentPost()
const busy = computed(() => transition.isPending.value || unallocate.isPending.value || post.isPending.value)
const confirming = ref<{ payment: FinancePayment; action: 'cancel' | 'reset-to-draft' | 'unallocate' } | null>(null)
const allocating = ref<FinancePayment | null>(null)
const editing = ref<FinancePayment | null>(null)
const actionError = ref('')
async function confirmTransition() {
  const pending = confirming.value
  if (!pending || !hydrated.value || busy.value) return
  await run(async () => {
    if (pending.action === 'unallocate') await unallocate.mutateAsync(pending.payment.id)
    else await transition.mutateAsync({ id: pending.payment.id, action: pending.action })
    confirming.value = null
  })
}
async function postPayment(payment: FinancePayment) {
  if (!hydrated.value || busy.value) return
  await run(async () => { await post.mutateAsync(payment.id) })
}
async function run(work: () => Promise<void>) {
  actionError.value = ''
  try {
    await work()
  } catch (cause) {
    actionError.value = financeErrorMessage(cause, financeErrorKey, t)
  }
}
const CONFIRM_KEYS = {
  cancel: { title: 'financeDocuments.payments.cancelConfirm', hint: 'financeDocuments.payments.cancelHint', label: 'financeDocuments.payments.cancel' },
  'reset-to-draft': { title: 'financeDocuments.payments.resetConfirm', hint: 'financeDocuments.payments.resetHint', label: 'financeDocuments.payments.resetToDraft' },
  unallocate: { title: 'financeDocuments.payments.unallocate.confirm', hint: 'financeDocuments.payments.unallocate.hint', label: 'financeDocuments.payments.unallocate.action' },
} as const
const standaloneTo = computed(() => can('finance.payments.manage') && !props.background ? standalonePaymentLink(route.fullPath) : undefined)
const transferTo = computed(() => can('finance.payments.manage') && !props.background ? transferPaymentLink(route.fullPath) : undefined)
const label = (payment: FinancePayment) => payment.name || `${t('financeDocuments.payments.draftNumber')} #${payment.id}`
function rowActions(payment: FinancePayment) {
  return offeredMenuItems(readFinanceActions(payment), [
    ['edit', { label: t('financeDocuments.payments.edit.action'), icon: 'i-lucide-pencil', onSelect: () => { editing.value = payment } }],
    ['post', { label: t('financeDocuments.payments.post'), icon: 'i-lucide-check', onSelect: () => { void postPayment(payment) } }],
    ['allocate', { label: t('financeDocuments.payments.allocate.action'), icon: 'i-lucide-link', onSelect: () => { allocating.value = payment } }],
    ['unallocate', { label: t('financeDocuments.payments.unallocate.action'), icon: 'i-lucide-unlink', onSelect: () => { confirming.value = { payment, action: 'unallocate' } } }],
    ['reset_to_draft', { label: t('financeDocuments.payments.resetToDraft'), icon: 'i-lucide-undo-2', onSelect: () => { confirming.value = { payment, action: 'reset-to-draft' } } }],
    ['cancel', { label: t('financeDocuments.payments.cancel'), icon: 'i-lucide-ban', destructive: true, onSelect: () => { confirming.value = { payment, action: 'cancel' } } }],
  ])
}
// Why some row actions are disabled, once for the page: the distinct reasons the server gave on the rows shown.
const blockedReasons = computed(() => [...new Set(items.value.flatMap(payment => payment.blocked_actions.map(item => item.reason)))])

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
  <div v-else class="liwan-page-stack">
    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" data-testid="finance-payment-action-error" />
    <FinanceBlockedNotice :reasons="blockedReasons" />
    <SharedInlineConfirm
      v-if="confirming"
      :title="t(CONFIRM_KEYS[confirming.action].title, { name: label(confirming.payment) })"
      :description="t(CONFIRM_KEYS[confirming.action].hint)"
      :confirm-label="t(CONFIRM_KEYS[confirming.action].label)"
      :color="confirming.action === 'cancel' ? 'error' : 'warning'"
      :pending="busy"
      :disabled="!hydrated"
      @confirm="confirmTransition"
      @cancel="confirming = null"
    />
    <PaymentEditPanel v-if="editing" :key="editing.id" :payment="editing" @done="editing = null" @cancel="editing = null" />
    <PaymentAllocate v-if="allocating" :payment="allocating" @done="allocating = null" @cancel="allocating = null" />
    <div v-if="standaloneTo || transferTo" class="flex flex-wrap justify-end gap-2">
      <UButton v-if="transferTo" color="neutral" variant="outline" icon="i-lucide-arrow-left-right" :to="transferTo" :label="t('financeDocuments.payments.transfer.link')" data-testid="finance-payment-transfer-new" />
      <UButton v-if="standaloneTo" color="neutral" variant="outline" icon="i-lucide-banknote" :to="standaloneTo" :label="t('financeDocuments.payments.standalone.link')" data-testid="finance-payment-standalone-new" />
    </div>
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
            <PartnerPicker id="finance-payment-filter-partner" class="md:w-56" :model-value="filters.partnerId" kind="any" :known="partner.data.value ? { id: partner.data.value.id, name: partner.data.value.name } : null" :placeholder="t('financeDocuments.filters.anyPartner')" :ui="{ placeholder: 'text-highlighted' }" @update:model-value="value => update({ partner_id: value ? String(value) : undefined, page: undefined })" />
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
        <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t(activeCount ? 'app.noResults' : 'financeDocuments.payments.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,820px)]">
          <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :loading="query.isPending.value" :caption="t('financeDocuments.payments.title')">
            <template #record_number-cell="{ row }"><SharedRecordNumber :value="row.original.id" /></template>
            <template #name-cell="{ row }"><span class="font-semibold text-highlighted" :data-testid="`finance-payment-row-${row.original.id}`"><bdi>{{ label(row.original) }}</bdi></span></template>
            <template #partner-cell="{ row }">{{ row.original.partner?.name ?? dash }}</template>
            <template #payment_type-cell="{ row }">{{ t(`financeDocuments.payments.types.${row.original.payment_type}`) }}</template>
            <template #journal-cell="{ row }">{{ row.original.journal.name }}</template>
            <template #date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date }}</bdi></template>
            <template #amount-cell="{ row }">
              <Money :amount="row.original.amount" :currency="row.original.currency" />
              <PaymentExchangeDifference :payment="row.original" />
            </template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="PAYMENT_STATE_TONE[row.original.state]" :label="t(`financeDocuments.payments.states.${row.original.state}`)" /></template>
            <template #actions-cell="{ row }"><SharedRowActions :actions="rowActions(row.original)" :label="t('financeDocuments.payments.actionsFor', { name: label(row.original) })" :disabled="busy" /></template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 flex-col gap-2">
                <span class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-semibold text-highlighted"><bdi>{{ label(row) }}</bdi></span>
                  <SharedStatusBadge size="sm" :tone="PAYMENT_STATE_TONE[row.state]" :label="t(`financeDocuments.payments.states.${row.state}`)" />
                </span>
                <span class="truncate text-sm text-muted">{{ row.partner?.name ?? dash }} · {{ t(`financeDocuments.payments.types.${row.payment_type}`) }}</span>
                <span class="flex items-center justify-between gap-2 text-sm">
                  <span class="flex flex-col"><Money :amount="row.amount" :currency="row.currency" /><PaymentExchangeDifference :payment="row" /></span>
                  <SharedRowActions :actions="rowActions(row)" :label="t('financeDocuments.payments.actionsFor', { name: label(row) })" :disabled="busy" />
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
