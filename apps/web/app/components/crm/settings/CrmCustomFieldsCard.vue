<script setup lang="ts">
import type { CrmSettings, CustomFieldDefinitionPatchItem } from '@liwan/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'

// The company's custom fields on every opportunity: the definition is shared by all records, so a new field appears
// empty on each of them and a removed one takes its values with it.
const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCrmSettingsCard<{ lead_properties: CustomFieldDefinitionPatchItem[] }>({
  settings: () => props.settings,
  read: ({ lead_properties }) => ({ lead_properties }),
  toPatch: ({ lead_properties }) => ({ values: { lead_properties } }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard id="customFields" v-bind="state" :title="t('crm.settings.customFields.title')" :description="t('crm.settings.customFields.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <SharedCustomFieldsEditor v-model="draft.lead_properties" :types="settings.options.property_types" :limits="settings.options.property_limits" :disabled="locked" />
  </SharedSettingsCard>
</template>
