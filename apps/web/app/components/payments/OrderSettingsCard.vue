<script setup lang="ts">
import { PAYMENT_ORDER_EXPIRY_MINUTES, type PaymentSettings } from '@webvue/contracts'
import { draftOfSettings, isValidExpiry, refusesExpiry, type OrderSettingsDraft, settingsUpdate } from '@/composables/paymentSettings'
import { useSavePaymentSettings } from '@/composables/usePaymentSettings'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// The payments settings of the online orders customers pay: how long an unpaid order waits before it is cancelled (this
// company) and whether a paid order is invoiced at once (the whole account). A save carries the revision of the latest
// settings; when another session saved first the server answers 409 and the card locks until the manager reloads.
const props = defineProps<{ settings: PaymentSettings; canEdit: boolean; reloadSettings: () => Promise<PaymentSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveSettings } = useSavePaymentSettings()

// What the server refused about the expiry on the last save.
const expiryRefusal = ref<string | null>(null)

const { draft, state, save, revert, reload } = useSettingsForm<PaymentSettings, OrderSettingsDraft>({
  source: () => props.settings,
  read: draftOfSettings,
  save: async (values, latest) => {
    expiryRefusal.value = null
    try {
      const saved = await saveSettings(settingsUpdate(latest, values))
      toast.add({ title: t('payments.orders.saved'), color: 'success' })
      return saved
    } catch (error) {
      if (!refusesExpiry(error)) throw error
      // The refusal is shown under the expiry input, so the card says only that the save failed.
      expiryRefusal.value = saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
      throw error instanceof ApiError ? new ApiError(error.status, error.code, '', error.field, error.details) : error
    }
  },
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
// A typed value outside the bounds is told at the input and is not sent; the untouched card says nothing.
const validExpiry = computed(() => isValidExpiry(draft.value.unpaid_order_expiry_minutes))
const expiryError = computed(() => expiryRefusal.value ?? (validExpiry.value ? undefined : t('payments.orders.expiry.invalid', PAYMENT_ORDER_EXPIRY_MINUTES)))
// A refusal belongs to the value that was sent; typing another value clears it.
watch(() => draft.value.unpaid_order_expiry_minutes, () => { expiryRefusal.value = null })
const submit = () => { if (validExpiry.value) return save() }
</script>

<template>
  <SharedSettingsCard id="orders" v-bind="state" :title="t('payments.orders.title')" :description="t('payments.orders.hint')" :can-edit="canEdit" data-testid="payments-orders" @save="submit" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('payments.orders.expiry.label')" name="unpaid_order_expiry_minutes" :description="t('payments.orders.expiry.hint', PAYMENT_ORDER_EXPIRY_MINUTES)" :error="expiryError">
      <UInputNumber
        id="payments-order-expiry"
        v-model="draft.unpaid_order_expiry_minutes"
        class="w-full"
        :min="PAYMENT_ORDER_EXPIRY_MINUTES.min"
        :max="PAYMENT_ORDER_EXPIRY_MINUTES.max"
        :disabled="locked"
      />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('payments.orders.invoiceWhenPaid.label')" :description="t('payments.orders.invoiceWhenPaid.hint')">
      <USwitch id="payments-order-invoice-when-paid" v-model="draft.invoice_when_paid" :disabled="locked" :aria-label="t('payments.orders.invoiceWhenPaid.label')" />
    </UFormField>
  </SharedSettingsCard>
</template>
