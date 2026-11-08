<script setup lang="ts">
import type { AiSettings } from '@liwan/contracts'
import { useRebuildAiKnowledge, useSaveAiSettings } from '@/composables/ai/useAiSettings'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// Knowledge retrieval (spec 2026-11-04 §6.3): lets the assistant search the company's records. It shows each person
// only what they can already read; the server checks that again on every search. Rebuilding the index re-queues every
// declared record, so it asks for an inline confirmation first.
const props = defineProps<{ settings: AiSettings; reloadSettings: () => Promise<AiSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveSettings } = useSaveAiSettings()
const { mutateAsync: rebuild, isPending: rebuilding } = useRebuildAiKnowledge()
const confirming = ref(false)

type Draft = Pick<AiSettings, 'knowledge_enabled'>
const { draft, state, save, revert, reload } = useSettingsForm<AiSettings, Draft>({
  source: () => props.settings,
  read: settings => ({ knowledge_enabled: settings.knowledge_enabled }),
  save: async (values, latest) => {
    const saved = await saveSettings({ ...values, revision: latest.revision })
    toast.add({ title: t('ai.settings.saved'), color: 'success' })
    return saved
  },
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || state.value.saving || state.value.reloading)

async function rebuildIndex() {
  try {
    await rebuild()
    confirming.value = false
    toast.add({ title: t('ai.settings.knowledge.rebuilt'), color: 'success' })
  } catch {
    toast.add({ title: t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <SharedSettingsCard id="knowledge" v-bind="state" :title="t('ai.settings.knowledge.title')" :description="t('ai.settings.knowledge.hint')" :can-edit="true" data-testid="ai-settings-knowledge" @save="save" @revert="revert" @reload="reload">
    <SharedSettingRow :label="t('ai.settings.knowledge.enabled')" name="knowledge_enabled" :description="t('ai.settings.knowledge.enabledHint')">
      <USwitch id="ai-knowledge-enabled" v-model="draft.knowledge_enabled" :disabled="locked" :aria-label="t('ai.settings.knowledge.enabled')" />
    </SharedSettingRow>
    <SharedInlineConfirm
      v-if="confirming" :title="t('ai.settings.knowledge.rebuildTitle')" :description="t('ai.settings.knowledge.rebuildHint')"
      :confirm-label="t('ai.settings.knowledge.rebuild')" :pending="rebuilding" @cancel="confirming = false" @confirm="rebuildIndex"
    />
    <SharedSettingRow v-else  :label="t('ai.settings.knowledge.rebuild')" name="rebuild" :description="t('ai.settings.knowledge.rebuildHint')">
      <UButton type="button" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :label="t('ai.settings.knowledge.rebuild')" :disabled="locked" data-testid="ai-knowledge-rebuild" @click="confirming = true" />
    </SharedSettingRow>
  </SharedSettingsCard>
</template>
