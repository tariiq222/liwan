<script setup lang="ts">
import PayHeader from '@/components/payments/PayHeader.vue'
import PayInvoiceSummary from '@/components/payments/PayInvoiceSummary.vue'
import { isInvalidLink, payStatusView } from '@/composables/paymentPay'
import { usePayableInvoice } from '@/composables/usePayableInvoice'

// Where the gateway's return lands the payer. The confirmation can trail the return by a few seconds, so for one
// minute the invoice is re-read while it is still payable (not confirmed yet) or processing; after that an unpaid
// invoice is reported as not paid, with the way back to try again.
definePageMeta({ layout: false, access: 'public' })

const { t } = useI18n()
const { link, windowOpen, data: invoice, error, isLoading, isError, refetch } = usePayableInvoice({ settle: true })

const invalidLink = computed(() => !link.value || isInvalidLink(error.value))
const view = computed(() => (invoice.value ? payStatusView(invoice.value.status, windowOpen.value) : null))
const payTo = computed(() => (link.value ? { path: `/pay/invoice/${link.value.id}`, query: { access_token: link.value.token } } : '/'))
</script>

<template>
  <SharedStandalonePage>
    <template #header><PayHeader :title="t('payments.pay.statusTitle')" /></template>
    <UAlert v-if="invalidLink" role="alert" color="error" variant="subtle" icon="i-lucide-link-2-off" :title="t('payments.pay.states.invalidLink.title')" :description="t('payments.pay.states.invalidLink.body')" data-testid="pay-invalid" />
    <div v-else-if="invoice && view" class="grid gap-4">
      <PayInvoiceSummary :invoice="invoice" />
      <UAlert v-if="view === 'paid'" role="status" color="success" variant="subtle" icon="i-lucide-circle-check" :title="t('payments.pay.states.paid.title')" :description="t('payments.pay.states.paid.body')" data-testid="pay-status-paid" />
      <UAlert v-else-if="view === 'processing'" role="status" color="info" variant="subtle" icon="i-lucide-clock" :title="t('payments.pay.states.processing.title')" :description="t('payments.pay.states.processing.body')" data-testid="pay-status-processing" />
      <template v-else-if="view === 'confirming'">
        <UAlert role="status" color="info" variant="subtle" icon="i-lucide-loader-circle" :title="t('payments.status.confirming.title')" :description="t('payments.status.confirming.body')" data-testid="pay-status-confirming" />
        <UButton :to="payTo" color="neutral" variant="ghost" class="w-full justify-center" :label="t('payments.status.backToPay')" />
      </template>
      <template v-else-if="view === 'notPaid'">
        <UAlert role="status" color="warning" variant="subtle" icon="i-lucide-circle-alert" :title="t('payments.status.notPaid.title')" :description="t('payments.status.notPaid.body')" data-testid="pay-status-not-paid" />
        <UButton :to="payTo" size="lg" class="w-full justify-center" icon="i-lucide-rotate-ccw" :label="t('payments.status.tryAgain')" data-testid="pay-try-again" />
      </template>
      <UAlert v-else role="status" color="warning" variant="subtle" icon="i-lucide-ban" :title="t('payments.pay.states.notPayable.title')" :description="t('payments.pay.states.notPayable.body')" data-testid="pay-status-not-payable" />
    </div>
    <div v-else-if="isError" class="grid gap-4">
      <UAlert role="alert" color="warning" variant="subtle" icon="i-lucide-cloud-off" :title="t('payments.pay.states.unavailable.title')" :description="t('payments.pay.states.unavailable.body')" data-testid="pay-unavailable" />
      <UButton color="neutral" variant="outline" class="w-full justify-center" icon="i-lucide-refresh-cw" :label="t('payments.pay.retry')" @click="() => refetch()" />
    </div>
    <SharedLoadingSkeleton v-else-if="isLoading" />
  </SharedStandalonePage>
</template>
