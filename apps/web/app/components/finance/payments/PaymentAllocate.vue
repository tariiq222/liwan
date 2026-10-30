<script setup lang="ts">
import type { FinancePayment } from '@liwan/contracts'
import { refDebounced } from '@vueuse/core'
import { useFinanceOpenInvoices } from '@/composables/finance/useFinanceInvoices'
import { useFinancePaymentAllocate } from '@/composables/finance/useFinancePayments'
import { financeErrorMessage } from '../financeErrors'
import { financeErrorKey } from '../invoices/invoiceErrors'
import { invoiceTitle } from '../invoices/invoiceKinds'
import { formatAmount } from '../invoices/formatAmount'

// Sets the unallocated part of a posted payment against open documents of the same party. The server settles as much
// as each document still owes and refuses a document of another party or currency.
const props = defineProps<{ payment: FinancePayment }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const allocate = useFinancePaymentAllocate()
const q = ref('')
const open = useFinanceOpenInvoices(refDebounced(q, 250))
const selected = ref<number[]>([])
const error = ref('')
const items = computed(() => (open.data.value?.items ?? [])
  .filter(invoice => invoice.amount_residual > 0 && invoice.partner?.id === props.payment.partner?.id && invoice.currency === props.payment.currency)
  .map(invoice => ({ value: invoice.id, label: `${invoiceTitle(invoice, t('financeDocuments.draftNumber'))} · ${formatAmount(invoice.amount_residual)} ${invoice.currency}` })))

async function submit() {
  if (!hydrated.value || allocate.isPending.value || !selected.value.length) return
  error.value = ''
  try {
    await allocate.mutateAsync({ id: props.payment.id, body: { invoice_ids: selected.value } })
    emit('done')
  } catch (cause) {
    error.value = financeErrorMessage(cause, financeErrorKey, t)
  }
}
</script>

<template>
  <UCard data-testid="finance-payment-allocate">
    <div class="grid gap-3">
      <p class="font-semibold text-highlighted">{{ t('financeDocuments.payments.allocate.title', { name: payment.name ?? `#${payment.id}`, amount: formatAmount(payment.unallocated), currency: payment.currency }) }}</p>
      <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
      <USelectMenu
        v-model="selected"
        v-model:search-term="q"
        multiple
        value-key="value"
        :items="items"
        :ignore-filter="true"
        :loading="open.isFetching.value"
        :placeholder="t('financeDocuments.payments.allocate.pick')"
        :search-input="{ placeholder: t('app.search') }"
        :aria-label="t('financeDocuments.payments.allocate.pick')"
        :disabled="!hydrated || allocate.isPending.value"
        class="w-full"
      />
      <div class="flex flex-wrap justify-end gap-2">
        <UButton color="neutral" variant="outline" :label="t('app.cancel')" @click="emit('cancel')" />
        <UButton :disabled="!hydrated || !selected.length" :loading="allocate.isPending.value" :label="t('financeDocuments.payments.allocate.submit')" data-testid="finance-payment-allocate-submit" @click="submit" />
      </div>
    </div>
  </UCard>
</template>
