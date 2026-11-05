<script setup lang="ts">
import type { AiProviderMode, AiSettings } from '@liwan/contracts'
import { useSaveAiSettings } from '@/composables/ai/useAiSettings'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// Whose provider account runs the tenant's AI: the platform's, or the tenant's own key (set in the card below). A save
// carries the revision the draft was read from; another session's save first answers 409 and the card locks until reloaded.
const props = defineProps<{ settings: AiSettings; reloadSettings: () => Promise<AiSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveSettings } = useSaveAiSettings()

const { draft, state, save, revert, reload } = useSettingsForm<AiSettings, { provider_mode: AiProviderMode }>({
  source: () => props.settings,
  read: settings => ({ provider_mode: settings.provider_mode }),
  save: async (values, latest) => {
    const saved = await saveSettings({ provider_mode: values.provider_mode, revision: latest.revision })
    toast.add({ title: t('ai.settings.saved'), color: 'success' })
    return saved
  },
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || state.value.saving || state.value.reloading)
const modes = computed(() => (['platform', 'tenant_key'] as const).map(value => ({ value, label: t(`ai.settings.provider.mode.${value}`) })))
</script>

<template>
  <SharedSettingsCard id="provider" v-bind="state" :title="t('ai.settings.provider.title')" :description="t('ai.settings.provider.hint')" :can-edit="true" data-testid="ai-settings-provider" @save="save" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('ai.settings.provider.mode.label')" name="provider_mode" :description="t(`ai.settings.provider.mode.${draft.provider_mode}Hint`)">
      <USelect id="ai-provider-mode" v-model="draft.provider_mode" class="w-full" :items="modes" :disabled="locked" :aria-label="t('ai.settings.provider.mode.label')" />
    </UFormField>
  </SharedSettingsCard>
</template>
