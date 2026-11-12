<script setup lang="ts">
import type { CustomerCandidate, InboxOrderCheckout, InboxOrderPaymentStatus, InboxOrderState } from '@liwan/contracts'
import InboxOrderCustomerStep from '@/components/inbox/InboxOrderCustomerStep.vue'
import InboxOrderEditor from '@/components/inbox/InboxOrderEditor.vue'
import InboxTemplatePicker from '@/components/inbox/InboxTemplatePicker.vue'
import { COMMERCE_LIMITS, customerChoiceBody, customerConflict, isPayLinkTemplate } from '@/composables/inbox/inboxCommerce'
import { useCancelInboxOrder, useCheckoutInboxOrder, useInboxOrder } from '@/composables/inbox/useInboxOrders'

// What an agent with `inbox.orders.manage` can do with one order, each step inline under the order: change a cart, create
// the online order and send its pay link (a link button inside the 24-hour window, an approved pay-link template after
// it), send the link again, and drop a cart or cancel an unpaid order (confirmed inline). When the contact has no
// customer and customers with its phone exist, the checkout stops at a step that asks which one (or a new one).
const props = defineProps<{
  orderId: number
  state: InboxOrderState
  paymentStatus: InboxOrderPaymentStatus | null
  conversationId: number
  channelId: number
  windowOpen: boolean
}>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { can } = useAccess()
type Step = 'edit' | 'checkout' | 'customer' | 'cancel'
const step = ref<Step | null>(null)
const body = ref('')
const templateId = ref<number | null>(null)
const candidates = ref<CustomerCandidate[]>([])

const manage = computed(() => can('inbox.orders.manage'))
const canManageTemplates = computed(() => can('inbox.channels.manage') || can('inbox.templates.manage'))
const isCart = computed(() => props.state === 'cart')
const unpaid = computed(() => props.state === 'ordered' && (props.paymentStatus === 'payable' || props.paymentStatus === 'processing' || props.paymentStatus === null))
const order = useInboxOrder(() => props.orderId, () => step.value === 'edit')
const { mutateAsync: checkout, isPending: checkingOut } = useCheckoutInboxOrder()
const { mutate: cancel, isPending: cancelling } = useCancelInboxOrder()
const busy = computed(() => !hydrated.value || checkingOut.value || cancelling.value)
const checkoutReady = computed(() => (props.windowOpen ? body.value.length <= COMMERCE_LIMITS.body : !!templateId.value))
const failureText = (e: unknown) => {
  const code = (e as { code?: string } | null)?.code
  if (code === 'invalid_phone') return t('inbox.orders.customer.invalidPhone')
  return e instanceof Error ? e.message : t('errors.generic')
}
const fail = (e: unknown) => toast.add({ title: failureText(e), color: 'error' })

function open(next: Step) {
  step.value = step.value === next ? null : next
}
const linkBody = (): InboxOrderCheckout => (props.windowOpen ? (body.value.trim() ? { body: body.value.trim() } : {}) : { template_id: templateId.value ?? undefined })
async function sendCheckout(extra: Partial<InboxOrderCheckout> = {}) {
  try {
    await checkout({ id: props.orderId, body: { ...linkBody(), ...extra } })
    toast.add({ title: t('inbox.orders.linkSent'), color: 'success' })
    step.value = null
    body.value = ''
  } catch (e) {
    const matches = customerConflict(e)
    if (matches) {
      candidates.value = matches
      step.value = 'customer'
      return
    }
    // A chosen customer that is gone sends the agent back to the form: the next send lists the customers again.
    const gone = (e as { status?: number } | null)?.status === 404 && 'customer_id' in extra
    if (gone) step.value = 'checkout'
    toast.add({ title: gone ? t('inbox.orders.customer.notFound') : failureText(e), color: 'error' })
  }
}
async function submitCheckout() {
  if (busy.value || !checkoutReady.value) return
  await sendCheckout()
}
async function chooseCustomer(choice: string) {
  if (busy.value) return
  await sendCheckout(customerChoiceBody(choice))
}
function confirmCancel() {
  cancel(props.orderId, { onSuccess: () => { step.value = null }, onError: fail })
}
</script>

<template>
  <div v-if="manage && (isCart || unpaid)" class="flex flex-col gap-2" data-testid="inbox-order-actions">
    <div class="flex flex-wrap items-center gap-2">
      <UButton v-if="isCart" type="button" size="sm" color="neutral" variant="outline" icon="i-lucide-pencil" :label="t('inbox.orders.edit')" :aria-pressed="step === 'edit'" :disabled="busy" data-testid="inbox-order-edit" @click="open('edit')" />
      <UButton type="button" size="sm" :icon="isCart ? 'i-lucide-send' : 'i-lucide-link'" :label="isCart ? t('inbox.orders.checkout') : t('inbox.orders.resendLink')" :aria-pressed="step === 'checkout' || step === 'customer'" :disabled="busy" data-testid="inbox-order-checkout" @click="open('checkout')" />
      <UButton type="button" size="sm" color="error" variant="ghost" :icon="isCart ? 'i-lucide-x' : 'i-lucide-ban'" :label="isCart ? t('inbox.orders.dismiss') : t('inbox.orders.cancel')" :disabled="busy || step === 'cancel'" data-testid="inbox-order-cancel" @click="step = 'cancel'" />
    </div>
    <SharedInlineConfirm
      v-if="step === 'cancel'"
      :title="isCart ? t('inbox.orders.dismissTitle') : t('inbox.orders.cancelTitle')"
      :description="isCart ? t('inbox.orders.dismissDescription') : t('inbox.orders.cancelDescription')"
      :confirm-label="isCart ? t('inbox.orders.dismiss') : t('inbox.orders.cancel')"
      :pending="cancelling"
      @confirm="confirmCancel"
      @cancel="step = null"
    />
    <InboxOrderCustomerStep v-else-if="step === 'customer'" :candidates="candidates" :pending="checkingOut" @choose="chooseCustomer" @cancel="step = 'checkout'" />
    <SharedSubCard v-else-if="step === 'checkout'" tone="tinted" class="flex flex-col gap-2" data-testid="inbox-order-checkout-form">
      <UFormField v-if="props.windowOpen" :label="t('inbox.orders.linkMessage')" :description="t('inbox.orders.linkMessageHint')" :hint="`${body.length}/${COMMERCE_LIMITS.body}`">
        <UTextarea v-model="body" class="w-full" :rows="2" autoresize :maxrows="6" :maxlength="COMMERCE_LIMITS.body" :disabled="busy" data-testid="inbox-order-link-body" />
      </UFormField>
      <template v-else>
        <UAlert color="info" variant="subtle" icon="i-lucide-clock" :title="t('inbox.composer.windowClosed')" :description="t('inbox.orders.templateNeeded')" />
        <UFormField :label="t('inbox.orders.payTemplate')" required>
          <InboxTemplatePicker v-model="templateId" :channel-id="props.channelId" :accept="isPayLinkTemplate" :disabled="busy" data-testid="inbox-order-template">
            <template #empty>
              <p class="text-sm text-status-warning-foreground" data-testid="inbox-order-no-template">
                {{ t('inbox.orders.noPayTemplate') }}
                <NuxtLink v-if="canManageTemplates" class="underline" :to="`/settings/apps/inbox/channels/${props.channelId}/templates`" data-testid="inbox-order-templates-link">
                  {{ t('inbox.orders.manageTemplates') }}
                </NuxtLink>
              </p>
            </template>
          </InboxTemplatePicker>
        </UFormField>
      </template>
      <div class="flex justify-end gap-2">
        <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" @click="step = null" />
        <UButton type="button" :label="isCart ? t('inbox.orders.checkout') : t('inbox.orders.resendLink')" :loading="checkingOut" :disabled="busy || !checkoutReady" data-testid="inbox-order-checkout-submit" @click="submitCheckout" />
      </div>
    </SharedSubCard>
    <template v-else-if="step === 'edit'">
      <SharedLoadingSkeleton v-if="order.isPending.value" />
      <SharedPageState v-else-if="order.error.value" :error="order.error.value" @retry="order.refetch()" />
      <InboxOrderEditor v-else-if="order.data.value" :conversation-id="props.conversationId" :order="order.data.value" @saved="step = null" @cancel="step = null" />
    </template>
  </div>
</template>
