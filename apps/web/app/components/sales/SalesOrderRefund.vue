<script setup lang="ts">
import { SalesOrderRefundBodySchema, type SalesOrder, type SalesOrderPayment } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { formatCurrency } from '@/utils/formatCurrency'
import { salesRefundErrorKey, salesRefundField, salesRefusalKey } from '@/composables/sales/salesErrors'
import { useRefundSalesOrder } from '@/composables/sales/useSalesOrders'

// Records a refund the tenant already made in its payment gateway's dashboard, for a holder of the refund right
// (`payment.can_refund`). It moves no money: it writes down how much went back and the gateway's reference for it.
// The amount starts at the most that may go back and cannot pass it; the save stays pending until the server answers
// with the order, which replaces the cached one.
const props = defineProps<{ order: SalesOrder; payment: SalesOrderPayment }>()
const emit = defineEmits<{ done: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const amount = ref<number | null>(props.payment.amount_refundable)
const reference = ref('')
const checked = ref(false)
const failure = ref<unknown>(null)
const { mutateAsync: refund, isPending } = useRefundSalesOrder()

const most = computed(() => props.payment.amount_refundable)
const parsed = computed(() => SalesOrderRefundBodySchema.safeParse({ amount: amount.value ?? 0, reference: reference.value }))
const invalidField = (field: 'amount' | 'reference') => !parsed.value.success && parsed.value.error.issues.some(issue => issue.path[0] === field)
const amountInvalid = computed(() => invalidField('amount') || (amount.value ?? 0) > most.value)
const referenceInvalid = computed(() => invalidField('reference'))
const refused = computed(() => salesRefundField(failure.value))
const amountError = computed(() => (checked.value && amountInvalid.value) || refused.value === 'amount' ? t('sales.refund.errors.amount') : undefined)
const referenceError = computed(() => (checked.value && referenceInvalid.value) || refused.value === 'reference' ? t('sales.refund.errors.reference') : undefined)
const message = computed(() => {
  const key = salesRefundErrorKey(failure.value) ?? salesRefusalKey(failure.value)
  return key ? t(key) : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))
})
// A refusal that names a field shows at it; any other shows under the form.
const alertMessage = computed(() => failure.value && !refused.value ? message.value : '')

async function save() {
  if (!hydrated.value || isPending.value) return
  checked.value = true
  failure.value = null
  if (amountInvalid.value || referenceInvalid.value) return
  try {
    await refund({ id: props.order.id, refund: { amount: amount.value!, reference: reference.value } })
    emit('done')
  } catch (error) { failure.value = error }
}
</script>

<template>
  <SharedSubCard data-testid="sales-refund">
    <form class="grid gap-3" novalidate @submit.prevent="save">
      <div>
        <p class="font-medium text-highlighted">{{ t('sales.refund.title') }}</p>
        <p class="text-sm text-muted" data-testid="sales-refund-hint">{{ t('sales.refund.hint') }}</p>
      </div>
      <div class="flex flex-wrap items-start gap-3">
        <UFormField :label="t('sales.refund.amount')" :help="t('sales.refund.amountHint', { max: formatCurrency(most, props.payment.currency, locale) })" :error="amountError" class="min-w-48 flex-1">
          <UInputNumber v-model="amount" class="w-full" :min="0.01" :max="most" :step="0.01" :disabled="isPending" data-testid="sales-refund-amount" />
        </UFormField>
        <UFormField :label="t('sales.refund.reference')" :help="t('sales.refund.referenceHint')" :error="referenceError" class="min-w-56 flex-1">
          <UInput v-model="reference" class="w-full" :maxlength="128" :disabled="isPending" data-testid="sales-refund-reference" />
        </UFormField>
      </div>
      <p v-if="alertMessage" role="alert" class="text-sm text-error" data-testid="sales-refund-error">{{ alertMessage }}</p>
      <div class="flex flex-wrap gap-2">
        <UButton type="submit" color="primary" :label="t('sales.refund.submit')" :loading="isPending" :disabled="!hydrated" data-testid="sales-refund-save" />
        <UButton color="neutral" variant="outline" :label="t('app.cancel')" :disabled="isPending" @click="emit('done')" />
      </div>
    </form>
  </SharedSubCard>
</template>
