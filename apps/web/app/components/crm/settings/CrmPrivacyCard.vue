<script setup lang="ts">
import type { CrmSettings } from '@liwan/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ visibility, view_log_enabled, view_log_retention_months }) => ({ visibility, view_log_enabled, view_log_retention_months }),
  toPatch: values => ({ values }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const visibilityItems = computed(() => [
  { value: 'own', label: t('crm.settings.privacy.own') },
  { value: 'all', label: t('crm.settings.privacy.all') },
])
const visibilityHint = computed(() => ({
  own: t('crm.settings.privacy.ownHint'),
  all: t('crm.settings.privacy.allHint'),
})[draft.value.visibility])
</script>

<template>
  <SharedSettingsCard id="privacy" v-bind="state" :title="t('crm.settings.privacy.title')" :description="t('crm.settings.privacy.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('crm.settings.privacy.visibility')" name="visibility" :description="visibilityHint">
      <USelect id="visibility" v-model="draft.visibility" class="w-full min-w-44" :items="visibilityItems" :disabled="locked" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('crm.settings.privacy.viewLog')" :description="t('crm.settings.privacy.viewLogHint')">
      <USwitch v-model="draft.view_log_enabled" :disabled="locked" :aria-label="t('crm.settings.privacy.viewLog')" />
    </UFormField>
    <UFormField
      v-if="draft.view_log_enabled"
      orientation="horizontal"
      :label="t('crm.settings.privacy.viewLogRetention')"
      :description="t('crm.settings.privacy.viewLogRetentionHint')"
      name="view_log_retention_months"
    >
      <UInput id="view-log-retention" v-model.number="draft.view_log_retention_months" type="number" min="1" max="60" class="w-24" :disabled="locked" />
    </UFormField>
  </SharedSettingsCard>
</template>
