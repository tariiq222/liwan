<script setup lang="ts">
import type { CustomerSettings, CustomerSharing } from '@liwan/contracts'
import { useCustomerSharingCard } from '@/composables/customers/useCustomerSharingCard'

// Whether customers belong to the whole establishment or to one branch. The consequences of sharing are stated before
// the choice, not after it. While customers exist the mode cannot change yet: the refusal keeps the saved value.
const props = defineProps<{ settings: CustomerSettings; canEdit: boolean; reloadSettings: () => Promise<CustomerSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload, transferRequired } = useCustomerSharingCard({ settings: () => props.settings, reload: () => props.reloadSettings() })
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const modes: CustomerSharing[] = ['branch', 'establishment']
const items = computed(() => modes.map(value => ({
  value,
  label: t(`customers.settings.sharing.${value}`),
  description: t(`customers.settings.sharing.${value}Hint`),
})))
</script>

<template>
  <SharedSettingsCard id="sharing" v-bind="state" :title="t('customers.settings.sharing.title')" :description="t('customers.settings.sharing.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <SharedOptionCards v-model="draft.sharing" :options="items" :disabled="locked" :label="t('customers.settings.sharing.title')" data-testid="customers-sharing" />
    <UAlert color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('customers.settings.sharing.shareTitle')" data-testid="customers-sharing-notice">
      <template #description>
        <ul class="list-disc ps-5">
          <li>{{ t('customers.settings.sharing.shareContacts') }}</li>
          <li>{{ t('customers.settings.sharing.shareEdit') }}</li>
        </ul>
      </template>
    </UAlert>
    <UAlert v-if="transferRequired" role="alert" color="error" variant="subtle" :title="t('customers.settings.sharing.transferTitle')" :description="t('customers.settings.sharing.transferRequired')" data-testid="customers-sharing-transfer" />
  </SharedSettingsCard>
</template>
