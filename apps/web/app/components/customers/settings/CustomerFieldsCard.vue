<script setup lang="ts">
import { CustomFieldTypeSchema, type CustomerSettings } from '@liwan/contracts'
import { useCustomerFieldsCard } from '@/composables/customers/useCustomerFieldsCard'
import CustomerFieldRemovalConfirm from './CustomerFieldRemovalConfirm.vue'

// The tenant's customer fields, in order. Removing a field that customers hold values for is refused by the server
// with the count of values it would delete; the card lists them and repeats the write only after the user confirms.
const props = defineProps<{ settings: CustomerSettings; canEdit: boolean; reloadSettings: () => Promise<CustomerSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload, removal, confirmRemoval, cancelRemoval } = useCustomerFieldsCard({
  settings: () => props.settings,
  reload: () => props.reloadSettings(),
  removalMessage: t('customers.settings.fields.removalNeeded'),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard id="fields" v-bind="state" :title="t('customers.settings.fields.title')" :description="t('customers.settings.fields.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <CustomerFieldRemovalConfirm v-if="removal" :fields="removal" :pending="state.saving" @confirm="confirmRemoval" @cancel="cancelRemoval" />
    <SharedCustomFieldsEditor v-model="draft.fields" :types="CustomFieldTypeSchema.options" :limits="settings.field_limits" :disabled="locked" />
  </SharedSettingsCard>
</template>
