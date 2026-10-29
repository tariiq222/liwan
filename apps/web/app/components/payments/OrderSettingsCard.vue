<script setup lang="ts">
import { PAYMENT_ORDER_EXPIRY_MINUTES, type PaymentSettings } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { draftOfSettings, isDraftChanged, isValidExpiry, refusesExpiry, settingsUpdate, type OrderSettingsDraft } from '@/composables/paymentSettings'
import { useSavePaymentSettings } from '@/composables/usePaymentSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// The payments settings of the online orders customers pay: how long an unpaid order waits before it is cancelled (this
// company) and whether a paid order is invoiced at once (the whole account). A save carries the revision the card was
// made from. When another session saved first the server answers 409: the card reads the saved settings again, shows them,
// and tells the manager, so a stale draft never overwrites newer values.
const props = defineProps<{ settings: PaymentSettings; reloadSettings: () => Promise<PaymentSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const save = useSavePaymentSettings()

const baseline = ref(props.settings)
const draft = ref<OrderSettingsDraft>(draftOfSettings(props.settings))
const reloading = ref(false)
const notice = ref<'conflict' | 'reloadFailed' | null>(null)
const failure = ref<string | null>(null)
const expiryFailure = ref<string | null>(null)

const dirty = computed(() => isDraftChanged(baseline.value, draft.value))
const valid = computed(() => isValidExpiry(draft.value.unpaid_order_expiry_minutes))
const busy = computed(() => !hydrated.value || save.isPending.value || reloading.value)
// A typed value outside the bounds is told at the input; the untouched card says nothing.
const expiryError = computed(() => expiryFailure.value ?? (valid.value ? undefined : t('payments.orders.expiry.invalid', PAYMENT_ORDER_EXPIRY_MINUTES)))

function adopt(settings: PaymentSettings) {
  baseline.value = settings
  draft.value = draftOfSettings(settings)
}
// A refresh of the settings (another card, a focus refetch) reaches a card with no edits; a draft in progress is kept and
// still saves against the revision it was made from.
watch(() => props.settings, (settings) => {
  if (!dirty.value && !busy.value) adopt(settings)
})

async function readSavedSettings() {
  reloading.value = true
  try {
    adopt(await props.reloadSettings())
    notice.value = 'conflict'
  } catch {
    notice.value = 'reloadFailed'
  } finally {
    reloading.value = false
  }
}

async function submit() {
  if (busy.value || !dirty.value || !valid.value) return
  failure.value = null
  expiryFailure.value = null
  notice.value = null
  try {
    adopt(await save.mutateAsync(settingsUpdate(baseline.value, draft.value)))
    toast.add({ title: t('payments.orders.saved'), color: 'success' })
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return readSavedSettings()
    const text = saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
    if (refusesExpiry(error)) expiryFailure.value = text
    else failure.value = text
  }
}
</script>

<template>
  <UForm novalidate :state="draft" class="webvue-form" method="post" data-testid="payments-orders" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('payments.orders.title')" :description="t('payments.orders.hint')">
      <UAlert v-if="notice === 'conflict'" role="status" color="warning" variant="subtle" icon="i-lucide-refresh-cw" :title="t('payments.orders.conflict')" data-testid="payments-orders-conflict" />
      <UAlert v-else-if="notice === 'reloadFailed'" role="alert" color="error" variant="subtle" :title="t('payments.orders.reloadFailed')" data-testid="payments-orders-reload-error" />
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('payments.orders.saveFailed')" :description="failure" data-testid="payments-orders-error" />
      <UFormField :label="t('payments.orders.expiry.label')" name="unpaid_order_expiry_minutes" :help="t('payments.orders.expiry.hint', PAYMENT_ORDER_EXPIRY_MINUTES)" :error="expiryError">
        <UInputNumber
          id="payments-order-expiry"
          v-model="draft.unpaid_order_expiry_minutes"
          class="w-full"
          :min="PAYMENT_ORDER_EXPIRY_MINUTES.min"
          :max="PAYMENT_ORDER_EXPIRY_MINUTES.max"
          :disabled="busy"
        />
      </UFormField>
      <USwitch
        id="payments-order-invoice-when-paid"
        v-model="draft.invoice_when_paid"
        :label="t('payments.orders.invoiceWhenPaid.label')"
        :description="t('payments.orders.invoiceWhenPaid.hint')"
        :disabled="busy"
      />
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="submit" class="ms-auto" :loading="save.isPending.value" :disabled="busy || !dirty || !valid" :label="t('app.saveChanges')" data-testid="payments-orders-save" />
    </SharedFormActions>
  </UForm>
</template>
