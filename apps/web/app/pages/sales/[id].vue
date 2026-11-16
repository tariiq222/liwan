<script setup lang="ts">
import type { SalesOrder, SalesOrderInvoice } from '@liwan/contracts'
import type { PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { STATUS_COLOR } from '@liwan/ui/app/utils/statusTone'
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { normalizedPath } from '@/utils/routePath'
import { saveErrorMessage } from '@/utils/formFeedback'
import { salesInvoicePath } from '@/utils/salesInvoicing'
import { ApiError } from '@/composables/useApi'
import SalesCustomerAnswer from '@/components/sales/SalesCustomerAnswer.vue'
import SalesOrderAssign from '@/components/sales/SalesOrderAssign.vue'
import SalesOrderDetails from '@/components/sales/SalesOrderDetails.vue'
import SalesOrderInvoiceForm from '@/components/sales/SalesOrderInvoiceForm.vue'
import SalesOrderInvoicing from '@/components/sales/SalesOrderInvoicing.vue'
import SalesOrderLinesPanel from '@/components/sales/SalesOrderLinesPanel.vue'
import SalesOrderOpportunity from '@/components/sales/SalesOrderOpportunity.vue'
import SalesOrderPayment from '@/components/sales/SalesOrderPayment.vue'
import SalesOrderRefund from '@/components/sales/SalesOrderRefund.vue'
import { SALES_STATE_TONE } from '@/components/sales/salesStatus'
import { salesRefusalKey } from '@/composables/sales/salesErrors'
import { useDuplicateSalesOrder, useSalesOrder, useSalesTransition, type SalesTransition } from '@/composables/sales/useSalesOrders'

// A quotation or order. The buttons are exactly what the server says the caller may do now (`order.actions`); an online
// order has none and says where it is managed.
const route = useRoute()
const sourcePaths = useRecordListPaths(['/sales'])
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
// A trailing slash still names the record, not a child page.
const isDetail = computed(() => normalizedPath(route.path) === `/sales/${route.params.id}`)
const query = useSalesOrder(computed(() => isDetail.value && validId.value ? id.value : null))
const order = computed(() => query.data.value)
// Invalid ids have no record to load and use the same not-found state as an unknown positive id.
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

const { mutateAsync: transition, isPending: moving, variables: moveArgs } = useSalesTransition()
const { mutateAsync: duplicate, isPending: duplicating } = useDuplicateSalesOrder()
const busy = computed(() => !hydrated.value || moving.value || duplicating.value)
const actionError = ref<unknown>(null)
const actionMessage = computed(() => {
  const key = salesRefusalKey(actionError.value)
  return key ? t(key) : saveErrorMessage(actionError.value, t('errors.generic'), t('errors.saveUncertain'))
})
// One inline question at a time: cancelling, or sending a quotation again (which clears the customer's earlier answer).
const confirming = ref<'cancel' | 'resend' | null>(null)
const confirmation = computed(() => {
  const current = order.value
  if (!current || !confirming.value) return null
  if (confirming.value === 'cancel') return { move: 'cancel', color: 'error', title: t('sales.record.cancelConfirm', { number: current.number }), description: t('sales.record.cancelHint'), action: t('sales.record.cancelConfirmAction') } as const
  return { move: 'send', color: 'warning', title: t('sales.record.resendConfirm', { number: current.number }), description: t(current.customer_answer?.answer ? 'sales.record.resendAnsweredHint' : 'sales.record.resendHint'), action: t('sales.record.resendConfirmAction') } as const
})
const toggleConfirm = (kind: 'cancel' | 'resend') => { confirming.value = confirming.value === kind ? null : kind }
const assigning = ref(false)
// The refund form opens from the record's actions while the server says a refund may be recorded.
const refunding = ref(false)
const canRefund = computed(() => !!order.value?.payment?.can_refund)
// The invoice form opens from the record's actions while the server says an invoice may be made (the bridge to Finance), and
// the invoice it made is named under the actions until the page is left or the next one is made. The form stays mounted
// until it reports the answer, which already says nothing more may be invoiced.
const invoicing = computed(() => order.value?.invoicing ?? null)
const canInvoice = computed(() => !!invoicing.value && (invoicing.value.can_invoice || invoicing.value.can_down_payment))
const invoiceOpen = ref(false)
const madeInvoice = ref<SalesOrderInvoice | null>(null)
const madeInvoiceTo = computed(() => madeInvoice.value ? { path: salesInvoicePath(madeInvoice.value.kind, madeInvoice.value.id), query: { returnTo: `/sales/${id.value}` } } : null)
function invoiceMade(saved: SalesOrder) {
  invoiceOpen.value = false
  madeInvoice.value = saved.invoicing?.invoices[0] ?? null
}
function toggleInvoice() {
  madeInvoice.value = null
  invoiceOpen.value = !invoiceOpen.value
}
// Why a confirmed order that is not locked offers no cancel while it has invoices, as the server decides: a posted invoice is
// credited in finance first, and a draft invoice is cancelled with the order only by someone who manages invoices.
const cancelBlock = computed<'posted' | 'draft' | null>(() => {
  if (order.value?.state !== 'confirmed' || order.value.locked || order.value.actions.cancel) return null
  const live = (invoicing.value?.invoices ?? []).filter(invoice => invoice.state !== 'cancel')
  if (live.some(invoice => invoice.state === 'posted')) return 'posted'
  return live.length ? 'draft' : null
})

async function move(name: SalesTransition) {
  if (!order.value || busy.value) return
  actionError.value = null
  try {
    await transition({ id: order.value.id, transition: name })
    confirming.value = null
  } catch (failure) { actionError.value = failure }
}
// The first send is one click; sending again asks first, because the server clears the customer's earlier answer.
const send = () => order.value?.state === 'sent' ? toggleConfirm('resend') : move('send')
async function copy() {
  if (!order.value || busy.value) return
  actionError.value = null
  try {
    const created = await duplicate(order.value.id)
    // The copy keeps the way back to the same list.
    await navigateTo({ path: `/sales/${created.id}`, query: route.query })
  } catch (failure) { actionError.value = failure }
}

const moveButtons = computed(() => {
  const actions = order.value?.actions
  if (!actions) return []
  // A draft is sent first; once it is sent, or cannot be, confirming is the main step.
  const sendFirst = actions.send && order.value?.state === 'draft'
  const buttons: { name: SalesTransition; label: string; icon: string; primary?: boolean }[] = [
    { name: 'send', label: order.value?.state === 'draft' ? 'send' : 'sendAgain', icon: 'i-lucide-send', primary: sendFirst },
    { name: 'confirm', label: 'confirm', icon: 'i-lucide-check', primary: !sendFirst },
    // A sent quotation goes back to a draft; a cancelled document is reopened.
    { name: 'reopen', label: order.value?.state === 'sent' ? 'backToDraft' : 'reopen', icon: 'i-lucide-rotate-ccw' },
    { name: 'lock', label: 'lock', icon: 'i-lucide-lock' },
    { name: 'unlock', label: 'unlock', icon: 'i-lucide-lock-open' },
  ]
  return buttons.filter(button => actions[button.name])
})
// The tenant does not let an answered quotation be sent again: the send button is gone, and reopening it is the way on.
const sendRefused = computed(() => !!order.value?.resend_refused && order.value.actions.reopen)
const pendingMove = (name: SalesTransition) => moving.value && moveArgs.value?.transition === name

const headerTags = computed<PageHeaderTag[]>(() => {
  if (!order.value) return []
  const tags: PageHeaderTag[] = [{ label: t(`sales.state.${order.value.state}`), tone: STATUS_COLOR[SALES_STATE_TONE[order.value.state]] }]
  if (order.value.expired) tags.push({ label: t('sales.expired'), tone: STATUS_COLOR.warning })
  if (order.value.locked) tags.push({ label: t('sales.record.locked'), kind: 'category', icon: 'i-lucide-lock' })
  if (order.value.source === 'online') tags.push({ label: t('sales.source.online'), kind: 'category', icon: 'i-lucide-globe' })
  return tags
})
</script>

<template>
  <SharedRecordPage
    v-if="isDetail"
    :keep-content="!!order"
    :title="order?.number || t('sales.recordTitle')"
    :tags="headerTags"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="order" #actions>
      <UButton v-if="order.actions.edit" color="primary" icon="i-lucide-pencil" :disabled="busy" :to="recordChildTo(`/sales/${id}/edit`, route.query, sourcePaths, route.hash)" :label="t('app.edit')" data-testid="sales-edit" @click="!hydrated && $event.preventDefault()" />
      <UButton v-for="button in moveButtons" :key="button.name" :color="button.primary ? 'primary' : 'neutral'" :variant="button.primary ? 'solid' : 'outline'" :icon="button.icon" :label="t(`sales.actions.${button.label}`)" :loading="pendingMove(button.name)" :disabled="busy" :data-testid="`sales-${button.name}`" @click="button.name === 'send' ? send() : move(button.name)" />
      <UButton v-if="order.actions.assign" color="neutral" variant="outline" icon="i-lucide-user-round-cog" :label="t('sales.actions.assign')" :disabled="busy" data-testid="sales-assign-open" @click="assigning = !assigning" />
      <UButton v-if="canInvoice" color="neutral" variant="outline" icon="i-lucide-receipt" :label="t('sales.invoicing.open')" :disabled="busy" data-testid="sales-invoice-open" @click="toggleInvoice" />
      <UButton v-if="order.payment?.can_refund" color="neutral" variant="outline" icon="i-lucide-hand-coins" :label="t('sales.refund.open')" :disabled="busy" data-testid="sales-refund-open" @click="refunding = !refunding" />
      <UButton v-if="order.source === 'staff'" color="neutral" variant="outline" icon="i-lucide-download" :href="`/api/v1/sales/orders/${order.id}/pdf`" external :label="t('sales.actions.pdf')" data-testid="sales-pdf" />
      <UButton v-if="order.actions.duplicate" color="neutral" variant="outline" icon="i-lucide-copy" :label="t('sales.actions.duplicate')" :loading="duplicating" :disabled="busy" data-testid="sales-duplicate" @click="copy" />
      <UButton v-if="order.actions.cancel" color="error" variant="outline" icon="i-lucide-x" :label="t('sales.actions.cancel')" :disabled="busy" data-testid="sales-cancel" @click="toggleConfirm('cancel')" />
    </template>
    <UAlert v-if="order?.source === 'online'" color="info" variant="subtle" icon="i-lucide-globe" :title="t('sales.record.onlineTitle')" :description="t('sales.record.online')" data-testid="sales-online" />
    <UAlert v-if="sendRefused" color="info" variant="subtle" icon="i-lucide-info" :title="t('sales.record.sendRefused')" data-testid="sales-send-refused" />
    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="t('sales.record.actionError')" :description="actionMessage" data-testid="sales-action-error" />
    <SharedInlineConfirm
      v-if="confirmation"
      :color="confirmation.color"
      :title="confirmation.title"
      :description="confirmation.description"
      :confirm-label="confirmation.action"
      :cancel-label="t('sales.record.confirmKeep')"
      :pending="pendingMove(confirmation.move)"
      @confirm="move(confirmation.move)"
      @cancel="confirming = null"
    />
    <SalesOrderAssign v-if="order && assigning && order.actions.assign" :order="order" @done="assigning = false" />
    <SalesOrderRefund v-if="order?.payment && refunding && canRefund" :order="order" :payment="order.payment" @done="refunding = false" />
    <SalesOrderInvoiceForm v-if="order && invoicing && invoiceOpen" :order="order" :invoicing="invoicing" @done="invoiceMade" @cancel="invoiceOpen = false" />
    <UAlert v-if="madeInvoiceTo" role="status" color="success" variant="subtle" icon="i-lucide-receipt" :title="t('sales.invoicing.created.title')" :description="t('sales.invoicing.created.body')" data-testid="sales-invoice-created">
      <template #actions>
        <UButton color="neutral" variant="outline" size="sm" :to="madeInvoiceTo" :label="t('sales.invoicing.openInvoice')" data-testid="sales-invoice-created-link" />
      </template>
    </UAlert>
    <UAlert v-if="cancelBlock" role="status" color="info" variant="subtle" icon="i-lucide-info" :title="t(cancelBlock === 'posted' ? 'sales.invoicing.cancelBlocked' : 'sales.invoicing.cancelBlockedDraft')" data-testid="sales-cancel-blocked" />
    <SalesOrderLinesPanel v-if="order" :order="order" />
    <SalesOrderInvoicing v-if="order && invoicing && (order.state === 'confirmed' || invoicing.invoices.length)" :invoicing="invoicing" :currency="order.currency.name" :order-id="order.id" :online="order.source === 'online'" />
    <template v-if="order" #aside>
      <SalesCustomerAnswer v-if="order.customer_answer" :answer="order.customer_answer" />
      <SalesOrderPayment v-if="order.payment && (order.payment.mode !== 'off' || order.payment.amount_received > 0)" :payment="order.payment" />
      <SalesOrderOpportunity v-if="order.opportunity" :opportunity="order.opportunity" />
      <SalesOrderDetails :order="order" />
    </template>
  </SharedRecordPage>
  <NuxtPage v-else />
</template>
