<script setup lang="ts">
import { AI_RETENTION_DAYS_MAX, AI_RETENTION_DAYS_MIN, type AiTenantConfig } from '@liwan/contracts'
import { useSaveAiRetention } from '@/composables/ai/useAiSettings'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// How long the tenant's AI conversations are kept. A shorter window deletes the older conversations at the next nightly
// cleanup, not at once.
const props = defineProps<{ config: AiTenantConfig; reloadConfig: () => Promise<AiTenantConfig> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveRetention } = useSaveAiRetention()
const bounds = { min: AI_RETENTION_DAYS_MIN, max: AI_RETENTION_DAYS_MAX }

const { draft, state, save, revert, reload } = useSettingsForm<AiTenantConfig, { retention_days: number }>({
  source: () => props.config,
  read: config => ({ retention_days: config.retention_days }),
  save: async (values) => {
    const saved = await saveRetention(values.retention_days)
    toast.add({ title: t('ai.settings.saved'), color: 'success' })
    return saved
  },
  reload: () => props.reloadConfig(),
})
const valid = computed(() => Number.isInteger(draft.value.retention_days) && draft.value.retention_days >= bounds.min && draft.value.retention_days <= bounds.max)
const submit = () => { if (valid.value) return save() }
</script>

<template>
  <SharedSettingsCard id="retention" v-bind="state" :title="t('ai.settings.retention.title')" :description="t('ai.settings.retention.hint')" :can-edit="true" data-testid="ai-settings-retention" @save="submit" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('ai.settings.retention.label')" name="retention_days" :description="t('ai.settings.retention.bounds', bounds)" :error="valid ? undefined : t('ai.settings.retention.invalid', bounds)">
      <UInputNumber id="ai-retention-days" v-model="draft.retention_days" class="w-full" :min="bounds.min" :max="bounds.max" :disabled="!hydrated || state.saving" />
    </UFormField>
  </SharedSettingsCard>
</template>
