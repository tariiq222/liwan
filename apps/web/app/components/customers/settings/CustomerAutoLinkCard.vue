<script setup lang="ts">
import type { CustomerSettings } from '@liwan/contracts'
import { useCustomerSettingsCard } from '@/composables/customers/useCustomerSettingsCard'

// Whether a new inbound contact whose phone matches exactly one customer is linked to it without staff. Off by default;
// it applies to contacts that arrive after the change and never to existing ones.
const props = defineProps<{ settings: CustomerSettings; canEdit: boolean; reloadSettings: () => Promise<CustomerSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCustomerSettingsCard({
  settings: () => props.settings,
  read: ({ auto_link_single_match }) => ({ auto_link_single_match }),
  toPatch: ({ auto_link_single_match }) => ({ auto_link_single_match }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard id="autoLink" v-bind="state" :title="t('customers.settings.autoLink.title')" :description="t('customers.settings.autoLink.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <SharedSettingRow :label="t('customers.settings.autoLink.label')" :description="t('customers.settings.autoLink.help')">
      <USwitch v-model="draft.auto_link_single_match" :disabled="locked" :aria-label="t('customers.settings.autoLink.label')" data-testid="customers-auto-link" />
    </SharedSettingRow>
  </SharedSettingsCard>
</template>
