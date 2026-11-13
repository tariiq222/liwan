<script setup lang="ts">
import type { CustomerPartyKinds, CustomerSettings } from '@liwan/contracts'
import { useCustomerSettingsCard } from '@/composables/customers/useCustomerSettingsCard'

// Which customers the tenant serves. It decides the form a new customer gets, never an existing customer.
const props = defineProps<{ settings: CustomerSettings; canEdit: boolean; reloadSettings: () => Promise<CustomerSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCustomerSettingsCard({
  settings: () => props.settings,
  read: ({ party_kinds }) => ({ party_kinds }),
  toPatch: ({ party_kinds }) => ({ party_kinds }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const kinds: CustomerPartyKinds[] = ['individuals', 'companies', 'both']
const items = computed(() => kinds.map(value => ({
  value,
  label: t(`customers.settings.partyKinds.${value}`),
  description: t(`customers.settings.partyKinds.${value}Hint`),
})))
</script>

<template>
  <SharedSettingsCard id="partyKinds" v-bind="state" :title="t('customers.settings.partyKinds.title')" :description="t('customers.settings.partyKinds.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <SharedOptionCards v-model="draft.party_kinds" :options="items" :disabled="locked" :label="t('customers.settings.partyKinds.title')" data-testid="customers-party-kinds" />
  </SharedSettingsCard>
</template>
