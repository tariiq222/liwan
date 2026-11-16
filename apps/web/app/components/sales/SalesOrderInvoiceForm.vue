<script setup lang="ts">
import { SALES_INVOICE_PERCENT, SalesOrderInvoiceBodySchema, type SalesOrder, type SalesOrderInvoiceBody, type SalesOrderInvoicing } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { formatCurrency } from '@/utils/formatCurrency'
import { salesInvoiceErrorKey, salesInvoiceField, salesRefusalKey } from '@/composables/sales/salesErrors'
import { useInvoiceSalesOrder } from '@/composables/sales/useSalesOrders'

type Method = SalesOrderInvoiceBody['method']

// Makes a draft invoice of a confirmed staff order, for a holder of both rights (`invoicing.can_invoice`, `can_down_payment`):
// the whole order, or a down payment by percent or by amount. Only the choices the server offers are shown, a figure the
// server would refuse (a percent outside 1 to 100, an amount above what is left to invoice) is refused here first, and the
// save stays pending until the server answers with the order, which replaces the cached one. The invoice is made as a draft:
// finance posts it.
const props = defineProps<{ order: SalesOrder; invoicing: SalesOrderInvoicing }>()
const emit = defineEmits<{ done: [order: SalesOrder]; cancel: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: invoice, isPending } = useInvoiceSalesOrder()

const methods = computed<Method[]>(() => [
  ...(props.invoicing.can_invoice ? ['order' as const] : []),
  ...(props.invoicing.can_down_payment ? ['percent' as const, 'amount' as const] : []),
])
const method = ref<Method>(methods.value[0] ?? 'order')
// What the server offers can change under an open form (a refetch of the order): the choice follows it, never one that is no
// longer offered, and the form closes when nothing is offered any more. While its own save runs it waits: that answer is what
// takes the offer away, and the page closes the form when the form reports it.
const saving = ref(false)
const percent = ref<number | null>(30)
const left = computed(() => props.invoicing.amount_to_invoice)
const amount = ref<number | null>(left.value)
const checked = ref(false)
const failure = ref<unknown>(null)
const items = computed(() => methods.value.map(value => ({ value, label: t(`sales.invoicing.form.${value}`), description: t(`sales.invoicing.form.${value}Hint`) })))
const maxText = computed(() => formatCurrency(left.value, props.order.currency.name, locale.value))

const body = computed(() => method.value === 'order' ? { method: 'order' } : method.value === 'percent' ? { method: 'percent', percent: percent.value ?? 0 } : { method: 'amount', amount: amount.value ?? 0 })
const parsed = computed(() => SalesOrderInvoiceBodySchema.safeParse(body.value))
// A down payment never passes what is left to invoice, whatever the percent says of the total.
const share = computed(() => Math.round((props.order.amount_total * (percent.value ?? 0)) / 100 * 100) / 100)
const percentInvalid = computed(() => method.value === 'percent' && (!parsed.value.success || share.value > left.value))
const amountInvalid = computed(() => method.value === 'amount' && (!parsed.value.success || (amount.value ?? 0) > left.value))
const refused = computed(() => salesInvoiceField(failure.value))
const percentError = computed(() => (checked.value && percentInvalid.value) || refused.value === 'percent' ? t('sales.invoicing.errors.percent') : undefined)
const amountError = computed(() => (checked.value && amountInvalid.value) || refused.value === 'amount' ? t('sales.invoicing.errors.amount') : undefined)
const message = computed(() => {
  const key = salesInvoiceErrorKey(failure.value) ?? salesRefusalKey(failure.value)
  return key ? t(key) : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))
})
// A refusal that names a figure shows at it; any other shows under the form.
const alertMessage = computed(() => failure.value && refused.value !== 'percent' && refused.value !== 'amount' ? message.value : '')

async function save() {
  if (!hydrated.value || isPending.value) return
  checked.value = true
  failure.value = null
  if (!parsed.value.success || percentInvalid.value || amountInvalid.value) return
  saving.value = true
  try {
    emit('done', await invoice({ id: props.order.id, invoice: parsed.value.data }))
  } catch (error) { failure.value = error } finally { saving.value = false }
}
</script>

<template>
  <SharedSubCard data-testid="sales-invoice-form">
    <form class="grid gap-4" novalidate @submit.prevent="save">
      <div>
        <p class="font-medium text-highlighted">{{ t('sales.invoicing.form.title') }}</p>
        <p class="text-sm text-muted">{{ t('sales.invoicing.form.hint') }}</p>
      </div>
      <SharedOptionCards v-model="method" :options="items" :disabled="isPending" :label="t('sales.invoicing.form.method')" data-testid="sales-invoice-method" />
      <UFormField v-if="method === 'percent'" :label="t('sales.invoicing.form.percentLabel')" :help="t('sales.invoicing.form.percentHelp')" :error="percentError">
        <UInputNumber v-model="percent" class="w-full" :min="SALES_INVOICE_PERCENT.min" :max="SALES_INVOICE_PERCENT.max" :step="1" :disabled="isPending" data-testid="sales-invoice-percent" />
      </UFormField>
      <UFormField v-if="method === 'amount'" :label="t('sales.invoicing.form.amountLabel')" :help="t('sales.invoicing.form.amountHelp', { max: maxText })" :error="amountError">
        <UInputNumber v-model="amount" class="w-full" :min="0.01" :max="left" :step="0.01" :disabled="isPending" data-testid="sales-invoice-amount" />
      </UFormField>
      <p v-if="alertMessage" role="alert" class="text-sm text-error" data-testid="sales-invoice-error">{{ alertMessage }}</p>
      <div class="flex flex-wrap gap-2">
        <UButton type="submit" color="primary" :label="t('sales.invoicing.form.submit')" :loading="isPending" :disabled="!hydrated" data-testid="sales-invoice-save" />
        <UButton color="neutral" variant="outline" :label="t('app.cancel')" :disabled="isPending" @click="emit('cancel')" />
      </div>
    </form>
  </SharedSubCard>
</template>
