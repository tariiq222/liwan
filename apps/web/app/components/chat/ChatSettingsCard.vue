<script setup lang="ts">
import type { ChatSettings } from '@liwan/contracts'
import { useSaveChatSettings } from '@/composables/useChatSettings'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// What deleting a message does in this company. A save carries the newest revision the page knows; when another
// session saved first the server answers 409, the card keeps the draft and locks until the saved settings are reloaded.
const props = defineProps<{ settings: ChatSettings; canEdit: boolean; reloadSettings: () => Promise<ChatSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: saveSettings } = useSaveChatSettings()

type Draft = { message_delete_mode: ChatSettings['values']['message_delete_mode'] }
const { draft, state, save, revert, reload } = useSettingsForm<ChatSettings, Draft>({
  source: () => props.settings,
  read: ({ values }) => ({ message_delete_mode: values.message_delete_mode }),
  save: (values, latest) => saveSettings({ revision: latest.revision, values: { message_delete_mode: values.message_delete_mode } }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading || state.value.conflict)
const items = computed(() => props.settings.options.message_delete_mode.map(value => ({
  value,
  label: t(`chatSettings.delete.${value}`),
  description: t(`chatSettings.delete.${value}Hint`),
})))
async function submit() {
  if (!hydrated.value || !props.canEdit) return
  await save()
}
</script>

<template>
  <SharedSettingsCard id="chat-delete-mode" v-bind="state" :title="t('chatSettings.delete.title')" :description="t('chatSettings.delete.hint')" :can-edit="canEdit" data-testid="chat-delete-mode" @save="submit" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('chatSettings.delete.label')" name="message_delete_mode">
      <URadioGroup v-model="draft.message_delete_mode" :items="items" :disabled="locked" data-testid="chat-delete-mode-options" />
    </UFormField>
  </SharedSettingsCard>
</template>
