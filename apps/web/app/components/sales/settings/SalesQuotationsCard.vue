<script setup lang="ts">
import { SALES_LIMITS, type SalesAnswerMode, type SalesSettings } from '@liwan/contracts'
import { useSalesSettingsCard } from '@/composables/sales/useSalesSettingsCard'

// What a new quotation starts with and how far a discount goes without approval: the validity in days and the default
// terms apply to new quotations only; the discount limit to new and edited lines (0 means no limit). The customer's
// answer sets what a sent quotation lets the customer do; acceptance can confirm the order by itself, which only
// makes sense while the customer may answer.
const props = defineProps<{ settings: SalesSettings; canEdit: boolean; reloadSettings: () => Promise<SalesSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload, refusedField } = useSalesSettingsCard(['validity_days', 'discount_limit_percent', 'default_terms', 'customer_answer', 'acceptance_confirms'] as const, { settings: () => props.settings, reload: () => props.reloadSettings() })
const empty = (value: number | null) => value === null
// A cleared number field holds null, which the server refuses; the card stops the save and says so at the field.
const numberError = (field: 'validity_days' | 'discount_limit_percent') => {
  if (empty(draft.value[field])) return t('sales.settings.quotations.numberRequired')
  return refusedField.value === field ? t('sales.settings.quotations.numberInvalid') : undefined
}
const submit = () => {
  if (empty(draft.value.validity_days) || empty(draft.value.discount_limit_percent)) return
  return save()
}
const answerModes: SalesAnswerMode[] = ['none', 'accept', 'accept_and_sign']
const answerItems = computed(() => answerModes.map(value => ({ value, label: t(`sales.settings.quotations.answer.${value}`), description: t(`sales.settings.quotations.answer.${value}Hint`) })))
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard id="quotations" v-bind="state" :title="t('sales.settings.quotations.title')" :description="t('sales.settings.quotations.hint')" :can-edit="canEdit" @save="submit" @revert="revert" @reload="reload">
    <div class="liwan-auto-grid [--liwan-auto-grid-min:14rem]">
      <UFormField :label="t('sales.settings.quotations.validityDays')" :help="t('sales.settings.quotations.validityDaysHint')" :error="numberError('validity_days')">
        <UInputNumber v-model="draft.validity_days" class="w-full" :min="0" :max="SALES_LIMITS.validityDays" :step="1" :disabled="locked" data-testid="sales-validity-days" />
      </UFormField>
      <UFormField :label="t('sales.settings.quotations.discountLimit')" :help="t('sales.settings.quotations.discountLimitHint')" :error="numberError('discount_limit_percent')">
        <UInputNumber v-model="draft.discount_limit_percent" class="w-full" :min="0" :max="100" :step="1" :disabled="locked" data-testid="sales-discount-limit" />
      </UFormField>
    </div>
    <UFormField :label="t('sales.settings.quotations.customerAnswer')" :help="t('sales.settings.quotations.customerAnswerHint')">
      <SharedOptionCards v-model="draft.customer_answer" :options="answerItems" :disabled="locked" :label="t('sales.settings.quotations.customerAnswer')" data-testid="sales-customer-answer" />
    </UFormField>
    <UFormField :label="t('sales.settings.quotations.acceptanceConfirms')" :help="t('sales.settings.quotations.acceptanceConfirmsHint')">
      <USwitch v-model="draft.acceptance_confirms" :disabled="locked || draft.customer_answer === 'none'" :aria-label="t('sales.settings.quotations.acceptanceConfirms')" data-testid="sales-acceptance-confirms" />
    </UFormField>
    <UFormField :label="t('sales.settings.quotations.defaultTerms')" :help="t('sales.settings.quotations.defaultTermsHint')">
      <UTextarea v-model="draft.default_terms" class="w-full" :rows="4" autoresize :maxlength="SALES_LIMITS.terms" :disabled="locked" data-testid="sales-default-terms" />
    </UFormField>
  </SharedSettingsCard>
</template>
