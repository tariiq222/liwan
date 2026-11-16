<script setup lang="ts">
import { SALES_PREPAYMENT_PERCENT, type SalesPaymentToConfirm, type SalesSettings } from '@liwan/contracts'
import { useSalesSettingsCard } from '@/composables/sales/useSalesSettingsCard'

// How a new quotation asks to be paid before it becomes an order: not at all, all of it, or a percentage of it. Each
// quotation keeps its own choice, so a change here applies to new quotations only. The card is shown while the tenant
// can take payments; the server leaves both values out of the settings otherwise.
const props = defineProps<{ settings: SalesSettings; canEdit: boolean; reloadSettings: () => Promise<SalesSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload, refusedField } = useSalesSettingsCard(['payment_to_confirm', 'prepayment_percent'] as const, { settings: () => props.settings, reload: () => props.reloadSettings() })
const modes: SalesPaymentToConfirm[] = ['off', 'full', 'percent']
const items = computed(() => modes.map(value => ({ value, label: t(`sales.settings.payment.${value}`), description: t(`sales.settings.payment.${value}Hint`) })))
const mode = computed({ get: () => draft.value.payment_to_confirm ?? 'off', set: value => { draft.value.payment_to_confirm = value } })
const percent = computed({ get: () => draft.value.prepayment_percent ?? null, set: value => { draft.value.prepayment_percent = value ?? undefined } })
// An empty percentage blocks the save only while the tenant's mode is a percentage; under any other mode the server keeps its saved one.
const percentMissing = computed(() => mode.value === 'percent' && percent.value === null)
const percentError = computed(() => {
  if (percentMissing.value) return t('sales.settings.payment.shareRequired')
  return refusedField.value === 'prepayment_percent' ? t('sales.settings.payment.shareInvalid') : undefined
})
const submit = () => (percentMissing.value ? undefined : save())
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard id="payments" v-bind="state" :title="t('sales.settings.payment.title')" :description="t('sales.settings.payment.hint')" :can-edit="canEdit" @save="submit" @revert="revert" @reload="reload">
    <UFormField :label="t('sales.settings.payment.mode')" :help="t('sales.settings.payment.modeHint')">
      <SharedOptionCards v-model="mode" :options="items" :disabled="locked" :label="t('sales.settings.payment.mode')" data-testid="sales-payment-default" />
    </UFormField>
    <UFormField :label="t('sales.settings.payment.shareLabel')" :help="t('sales.settings.payment.shareHint')" :error="percentError">
      <UInputNumber v-model="percent" class="w-full" :min="SALES_PREPAYMENT_PERCENT.min" :max="SALES_PREPAYMENT_PERCENT.max" :step="1" :disabled="locked || mode !== 'percent'" data-testid="sales-payment-default-percent" />
    </UFormField>
  </SharedSettingsCard>
</template>
