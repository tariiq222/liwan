<script setup lang="ts">
import type { SalesInvoiceActor, SalesInvoiceDownPayment, SalesSettings } from '@liwan/contracts'
import { useSalesSettingsCard } from '@/composables/sales/useSalesSettingsCard'

// Whether a confirmed order may be invoiced in advance (a down payment by percent or by amount) or only as a whole, and who may
// invoice an order: its salesperson (or an assign holder) or any caller who holds both rights. Both are read each time an invoice
// is made, so a change applies to the invoices made after it. The card is shown while the tenant has Finance; the server leaves
// the values out of the settings otherwise.
const props = defineProps<{ settings: SalesSettings; canEdit: boolean; reloadSettings: () => Promise<SalesSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useSalesSettingsCard(['invoice_down_payment', 'invoice_actor'] as const, { settings: () => props.settings, reload: () => props.reloadSettings() })
const modes: SalesInvoiceDownPayment[] = ['allow', 'refuse']
const actors: SalesInvoiceActor[] = ['owner', 'any_biller']
const choices = <Value extends string>(values: Value[]) => values.map(value => ({ value, label: t(`sales.settings.invoicing.${value}`), description: t(`sales.settings.invoicing.${value}Hint`) }))
const items = computed(() => choices(modes))
const actorItems = computed(() => choices(actors))
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard id="invoicing" v-bind="state" :title="t('sales.settings.invoicing.title')" :description="t('sales.settings.invoicing.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <UFormField :label="t('sales.settings.invoicing.downPayment')" :help="t('sales.settings.invoicing.downPaymentHint')">
      <SharedOptionCards v-model="draft.invoice_down_payment" :options="items" :disabled="locked" :label="t('sales.settings.invoicing.downPayment')" data-testid="sales-invoicing-down-payment" />
    </UFormField>
    <UFormField :label="t('sales.settings.invoicing.actor')" :help="t('sales.settings.invoicing.actorHint')">
      <SharedOptionCards v-model="draft.invoice_actor" :options="actorItems" :disabled="locked" :label="t('sales.settings.invoicing.actor')" data-testid="sales-invoicing-actor" />
    </UFormField>
  </SharedSettingsCard>
</template>
