<script setup lang="ts">
import { AI_INPUT_TOKENS_PER_RUN_MAX, AI_MESSAGES_PER_USER_MAX, type AiSettings } from '@liwan/contracts'
import { useSaveAiSettings } from '@/composables/ai/useAiSettings'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// How far the assistant may go for every employee, inside the package: messages per employee each month (0 means only
// the package limit applies), the input tokens one request may send (issue #554; 0 means no ceiling of the tenant's own),
// and whether it may send to an outside party after approval or only prepare a draft.
const props = defineProps<{ settings: AiSettings; reloadSettings: () => Promise<AiSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveSettings } = useSaveAiSettings()

type Draft = Pick<AiSettings, 'messages_per_user_monthly' | 'input_tokens_per_run' | 'external_send'>
const { draft, state, save, revert, reload } = useSettingsForm<AiSettings, Draft>({
  source: () => props.settings,
  read: settings => ({ messages_per_user_monthly: settings.messages_per_user_monthly, input_tokens_per_run: settings.input_tokens_per_run, external_send: settings.external_send }),
  save: async (values, latest) => {
    const saved = await saveSettings({ ...values, revision: latest.revision })
    toast.add({ title: t('ai.settings.saved'), color: 'success' })
    return saved
  },
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || state.value.saving || state.value.reloading)
const sendModes = computed(() => (['draft_only', 'approve'] as const).map(value => ({ value, label: t(`ai.settings.policy.external.${value}`) })))
</script>

<template>
  <SharedSettingsCard id="policy" v-bind="state" :title="t('ai.settings.policy.title')" :description="t('ai.settings.policy.hint')" :can-edit="true" data-testid="ai-settings-policy" @save="save" @revert="revert" @reload="reload">
    <SharedSettingRow :label="t('ai.settings.policy.perUser.label')" name="messages_per_user_monthly" :description="t('ai.settings.policy.perUser.hint')">
      <UInputNumber id="ai-per-user" v-model="draft.messages_per_user_monthly" class="w-full" :min="0" :max="AI_MESSAGES_PER_USER_MAX" :disabled="locked" :aria-label="t('ai.settings.policy.perUser.label')" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('ai.settings.policy.inputTokens.label')" name="input_tokens_per_run" :description="t('ai.settings.policy.inputTokens.hint')">
      <UInputNumber id="ai-input-tokens" v-model="draft.input_tokens_per_run" class="w-full" :min="0" :max="AI_INPUT_TOKENS_PER_RUN_MAX" :disabled="locked" :aria-label="t('ai.settings.policy.inputTokens.label')" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('ai.settings.policy.external.label')" name="external_send" :description="t(`ai.settings.policy.external.${draft.external_send}Hint`)">
      <USelect id="ai-external-send" v-model="draft.external_send" class="w-full" :items="sendModes" :disabled="locked" :aria-label="t('ai.settings.policy.external.label')" />
    </SharedSettingRow>
  </SharedSettingsCard>
</template>
