<script setup lang="ts">
import PayDocumentSummary from '@/components/payments/PayDocumentSummary.vue'
import PayHeader from '@/components/payments/PayHeader.vue'
import { leaveForGateway } from '@/composables/gatewayRedirect'
import { isInvalidLink, optionKey, startErrorKey } from '@/composables/paymentPay'
import { usePayableDocument, useStartPayment } from '@/composables/usePayableDocument'

// The public page a customer opens from the payment link of an invoice or an online order: no account, no session. The
// access token in the address is the only credential. Paying starts a transaction, remembers where to come back to, and
// sends the browser to the gateway.
definePageMeta({ layout: false, access: 'public' })

const { t } = useI18n()
const hydrated = useHydrated()
const { kind, link, data: payable, error, isLoading, isError, refetch } = usePayableDocument()
const start = useStartPayment()

// The words that name the document ("pay the invoice", "this order is paid") belong to its kind.
const text = (name: string) => t(`payments.pay.${kind.value}.${name}`)
const title = computed(() => (kind.value ? text('title') : t('payments.title')))

const invalidLink = computed(() => !link.value || isInvalidLink(error.value))
const options = computed(() => payable.value?.options ?? [])
const chosenKey = ref<string>()
const picked = computed(() => options.value.find(option => optionKey(option) === chosenKey.value) ?? options.value[0])
const radioItems = computed(() => options.value.map(option => ({ value: optionKey(option), label: option.method_name, description: option.provider })))

// The payer leaves the page after a successful start; the button stays busy until then.
const redirecting = ref(false)
const startError = ref<string | null>(null)

async function pay() {
  const option = picked.value
  if (!link.value || !option || !hydrated.value || start.isPending.value || redirecting.value) return
  startError.value = null
  try {
    const { redirect } = await start.mutateAsync({ link: link.value, option })
    redirecting.value = true
    leaveForGateway(link.value, redirect)
  } catch (cause) {
    redirecting.value = false
    const key = startErrorKey(link.value.kind, cause)
    startError.value = t(key ?? 'payments.pay.errors.failed')
    // The document may have been paid, cancelled or its link withdrawn meanwhile: read it again so the page tells the truth.
    if (key !== null || isInvalidLink(cause)) await refetch()
  }
}

// Pressing back from the gateway can restore this page from the browser's cache as it was left (busy): make it usable again.
useEventListener('pageshow', (event: PageTransitionEvent) => {
  if (!event.persisted) return
  redirecting.value = false
  void refetch()
})
</script>

<template>
  <SharedStandalonePage>
    <template #header><PayHeader :title="title" /></template>
    <UAlert v-if="invalidLink" role="alert" color="error" variant="subtle" icon="i-lucide-link-2-off" :title="t('payments.pay.states.invalidLink.title')" :description="t('payments.pay.states.invalidLink.body')" data-testid="pay-invalid" />
    <div v-else-if="kind && payable" class="grid gap-4">
      <PayDocumentSummary :kind="kind" :payable="payable" />
      <template v-if="payable.status === 'payable' && options.length">
        <URadioGroup
          :model-value="picked && optionKey(picked)"
          :items="radioItems"
          :legend="t('payments.pay.chooseMethod')"
          variant="card"
          :disabled="!hydrated || redirecting"
          data-testid="pay-options"
          @update:model-value="chosenKey = String($event)"
        />
        <UAlert v-if="startError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="startError" data-testid="pay-start-error" />
        <UButton size="lg" class="w-full justify-center" icon="i-lucide-lock" :loading="start.isPending.value || redirecting" :disabled="!hydrated || !picked" :label="redirecting ? t('payments.pay.redirecting') : t('payments.pay.submit')" data-testid="pay-submit" @click="pay" />
        <p class="text-center text-xs text-muted">{{ t('payments.pay.secure') }}</p>
      </template>
      <UAlert v-else-if="payable.status === 'payable'" role="status" color="warning" variant="subtle" icon="i-lucide-credit-card" :title="text('states.noOptions.title')" :description="text('states.noOptions.body')" data-testid="pay-no-options" />
      <UAlert v-else-if="payable.status === 'paid'" role="status" color="success" variant="subtle" icon="i-lucide-circle-check" :title="text('states.paid.title')" :description="text('states.paid.body')" data-testid="pay-paid" />
      <template v-else-if="payable.status === 'processing'">
        <UAlert role="status" color="info" variant="subtle" icon="i-lucide-clock" :title="t('payments.pay.states.processing.title')" :description="t('payments.pay.states.processing.body')" data-testid="pay-processing" />
        <UButton color="neutral" variant="outline" class="w-full justify-center" icon="i-lucide-refresh-cw" :label="t('payments.pay.refresh')" @click="() => refetch()" />
      </template>
      <UAlert v-else role="status" color="warning" variant="subtle" icon="i-lucide-ban" :title="text('states.notPayable.title')" :description="text('states.notPayable.body')" data-testid="pay-not-payable" />
    </div>
    <div v-else-if="isError" class="grid gap-4">
      <UAlert role="alert" color="warning" variant="subtle" icon="i-lucide-cloud-off" :title="text('states.unavailable.title')" :description="text('states.unavailable.body')" data-testid="pay-unavailable" />
      <UButton color="neutral" variant="outline" class="w-full justify-center" icon="i-lucide-refresh-cw" :label="t('payments.pay.retry')" @click="() => refetch()" />
    </div>
    <SharedLoadingSkeleton v-else-if="isLoading" />
  </SharedStandalonePage>
</template>
