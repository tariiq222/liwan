<script setup lang="ts">
import type { InboxOrderPaymentStatus, InboxOrderState } from '@webvue/contracts'
import InboxOrderEditor from '@/components/inbox/InboxOrderEditor.vue'
import { COMMERCE_LIMITS } from '@/composables/inbox/inboxCommerce'
import { useInboxTemplates } from '@/composables/inbox/useInbox'
import { useCancelInboxOrder, useCheckoutInboxOrder, useInboxOrder } from '@/composables/inbox/useInboxOrders'

// What an agent with `inbox.orders.manage` can do with one order, each step inline under the order: change a cart, create
// the online order and send its pay link (a link button inside the 24-hour window, an approved pay-link template after
// it), send the link again, and drop a cart or cancel an unpaid order (confirmed inline).
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
type Step = 'edit' | 'checkout' | 'cancel'
const step = ref<Step | null>(null)
const body = ref('')
const templateId = ref<number | undefined>(undefined)

const manage = computed(() => can('inbox.orders.manage'))
const isCart = computed(() => props.state === 'cart')
const unpaid = computed(() => props.state === 'ordered' && (props.paymentStatus === 'payable' || props.paymentStatus === 'processing' || props.paymentStatus === null))
const order = useInboxOrder(() => props.orderId, () => step.value === 'edit')
const { data: templates } = useInboxTemplates(() => props.channelId, () => step.value === 'checkout' && !props.windowOpen)
// A pay-link template has a url button to the pay page that ends in a variable; the server checks the exact prefix.
const payTemplates = computed(() => (templates.value?.items ?? []).filter(item => item.supported && item.buttons.some(button => button.type === 'url' && button.url.includes('/pay/order/') && button.url.endsWith('{{1}}'))).map(item => ({ value: item.id, label: `${item.name} · ${item.language}` })))
const { mutateAsync: checkout, isPending: checkingOut } = useCheckoutInboxOrder()
const { mutate: cancel, isPending: cancelling } = useCancelInboxOrder()
const busy = computed(() => !hydrated.value || checkingOut.value || cancelling.value)
const checkoutReady = computed(() => (props.windowOpen ? body.value.length <= COMMERCE_LIMITS.body : !!templateId.value))
const fail = (e: unknown) => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })

function open(next: Step) {
  step.value = step.value === next ? null : next
}
async function submitCheckout() {
  if (busy.value || !checkoutReady.value) return
  try {
    await checkout({ id: props.orderId, body: props.windowOpen ? (body.value.trim() ? { body: body.value.trim() } : {}) : { template_id: templateId.value } })
    toast.add({ title: t('inbox.orders.linkSent'), color: 'success' })
    step.value = null
    body.value = ''
  } catch (e) {
    fail(e)
  }
}
function confirmCancel() {
  cancel(props.orderId, { onSuccess: () => { step.value = null }, onError: fail })
}
</script>

<template>
  <div v-if="manage && (isCart || unpaid)" class="flex flex-col gap-2" data-testid="inbox-order-actions">
    <div class="flex flex-wrap items-center gap-2">
      <UButton v-if="isCart" type="button" size="sm" color="neutral" variant="outline" icon="i-lucide-pencil" :label="t('inbox.orders.edit')" :aria-pressed="step === 'edit'" :disabled="busy" data-testid="inbox-order-edit" @click="open('edit')" />
      <UButton type="button" size="sm" :icon="isCart ? 'i-lucide-send' : 'i-lucide-link'" :label="isCart ? t('inbox.orders.checkout') : t('inbox.orders.resendLink')" :aria-pressed="step === 'checkout'" :disabled="busy" data-testid="inbox-order-checkout" @click="open('checkout')" />
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
    <SharedSubCard v-else-if="step === 'checkout'" tone="tinted" class="flex flex-col gap-2" data-testid="inbox-order-checkout-form">
      <UFormField v-if="props.windowOpen" :label="t('inbox.orders.linkMessage')" :description="t('inbox.orders.linkMessageHint')" :hint="`${body.length}/${COMMERCE_LIMITS.body}`">
        <UTextarea v-model="body" class="w-full" :rows="2" autoresize :maxrows="6" :maxlength="COMMERCE_LIMITS.body" :disabled="busy" data-testid="inbox-order-link-body" />
      </UFormField>
      <template v-else>
        <UAlert color="info" variant="subtle" icon="i-lucide-clock" :title="t('inbox.composer.windowClosed')" :description="t('inbox.orders.templateNeeded')" />
        <p v-if="!payTemplates.length" class="text-sm text-warning" data-testid="inbox-order-no-template">{{ t('inbox.orders.noPayTemplate') }}</p>
        <UFormField v-else :label="t('inbox.orders.payTemplate')" required>
          <USelect v-model="templateId" class="w-full" :items="payTemplates" :placeholder="t('inbox.composer.pickTemplate')" :disabled="busy" data-testid="inbox-order-template" />
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
