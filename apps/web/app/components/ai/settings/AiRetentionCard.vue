<script setup lang="ts">
import { AI_LEAVER_RETENTION_DAYS_MAX, AI_RETENTION_DAYS_MAX, AI_RETENTION_DAYS_MIN, type AiTenantConfig } from '@liwan/contracts'
import { useSaveAiLeaverRetention, useSaveAiRetention } from '@/composables/ai/useAiSettings'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// How long the tenant's AI conversations are kept, and how long a leaver's are kept after their account is switched off
// (their notes go at once). A shorter window deletes the older conversations at the next nightly cleanup, not at once.
const props = defineProps<{ config: AiTenantConfig; reloadConfig: () => Promise<AiTenantConfig> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveRetention } = useSaveAiRetention()
const { mutateAsync: saveLeaverRetention } = useSaveAiLeaverRetention()
const bounds = { min: AI_RETENTION_DAYS_MIN, max: AI_RETENTION_DAYS_MAX }
const leaverBounds = { min: 0, max: AI_LEAVER_RETENTION_DAYS_MAX }

type Draft = { retention_days: number; leaver_retention_days: number }
const { draft, state, save, revert, reload } = useSettingsForm<AiTenantConfig, Draft>({
  source: () => props.config,
  read: config => ({ retention_days: config.retention_days, leaver_retention_days: config.leaver_retention_days }),
  save: async (values, latest) => {
    let saved = latest
    if (values.retention_days !== latest.retention_days) saved = await saveRetention(values.retention_days)
    if (values.leaver_retention_days !== latest.leaver_retention_days) saved = await saveLeaverRetention(values.leaver_retention_days)
    toast.add({ title: t('ai.settings.saved'), color: 'success' })
    return saved
  },
  reload: () => props.reloadConfig(),
})
const within = (value: number, range: { min: number; max: number }) => Number.isInteger(value) && value >= range.min && value <= range.max
const valid = computed(() => within(draft.value.retention_days, bounds))
const leaverValid = computed(() => within(draft.value.leaver_retention_days, leaverBounds))
const submit = () => { if (valid.value && leaverValid.value) return save() }
</script>

<template>
  <SharedSettingsCard id="retention" v-bind="state" :title="t('ai.settings.retention.title')" :description="t('ai.settings.retention.hint')" :can-edit="true" data-testid="ai-settings-retention" @save="submit" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('ai.settings.retention.label')" name="retention_days" :description="t('ai.settings.retention.bounds', bounds)" :error="valid ? undefined : t('ai.settings.retention.invalid', bounds)">
      <UInputNumber id="ai-retention-days" v-model="draft.retention_days" class="w-full" :min="bounds.min" :max="bounds.max" :disabled="!hydrated || state.saving" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('ai.settings.retention.leaverLabel')" name="leaver_retention_days" :description="t('ai.settings.retention.leaverHint', leaverBounds)" :error="leaverValid ? undefined : t('ai.settings.retention.invalid', leaverBounds)">
      <UInputNumber id="ai-leaver-retention-days" v-model="draft.leaver_retention_days" class="w-full" :min="leaverBounds.min" :max="leaverBounds.max" :disabled="!hydrated || state.saving" />
    </UFormField>
  </SharedSettingsCard>
</template>
