<script setup lang="ts">
import type { SalesOpportunityWin, SalesOpportunityWinAmount, SalesSettings } from '@liwan/contracts'
import { useSalesSettingsCard } from '@/composables/sales/useSalesSettingsCard'

// When a confirmed order wins the CRM opportunity it was written from, and for what amount: as soon as the order is
// confirmed (the opportunity needs no package) or never (its agent wins it with a package), and the untaxed or the taxed
// total of its confirmed orders. A change applies to the orders confirmed after it. The card is shown while the tenant has
// CRM; the server leaves both values out of the settings otherwise.
const props = defineProps<{ settings: SalesSettings; canEdit: boolean; reloadSettings: () => Promise<SalesSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useSalesSettingsCard(['opportunity_win', 'opportunity_win_amount'] as const, { settings: () => props.settings, reload: () => props.reloadSettings() })
const wins: SalesOpportunityWin[] = ['order_confirmed', 'manual']
const amounts: SalesOpportunityWinAmount[] = ['untaxed', 'total']
const winItems = computed(() => wins.map(value => ({ value, label: t(`sales.settings.opportunity.${value}`), description: t(`sales.settings.opportunity.${value}Hint`) })))
const amountItems = computed(() => amounts.map(value => ({ value, label: t(`sales.settings.opportunity.${value}`), description: t(`sales.settings.opportunity.${value}Hint`) })))
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard id="opportunity" v-bind="state" :title="t('sales.settings.opportunity.title')" :description="t('sales.settings.opportunity.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <UFormField :label="t('sales.settings.opportunity.win')" :help="t('sales.settings.opportunity.winHint')">
      <SharedOptionCards v-model="draft.opportunity_win" :options="winItems" :disabled="locked" :label="t('sales.settings.opportunity.win')" data-testid="sales-opportunity-win" />
    </UFormField>
    <UFormField :label="t('sales.settings.opportunity.amount')" :help="t('sales.settings.opportunity.amountHint')">
      <SharedOptionCards v-model="draft.opportunity_win_amount" :options="amountItems" :disabled="locked" :label="t('sales.settings.opportunity.amount')" data-testid="sales-opportunity-amount" />
    </UFormField>
  </SharedSettingsCard>
</template>
