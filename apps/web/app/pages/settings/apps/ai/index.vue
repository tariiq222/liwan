<script setup lang="ts">
import AiKeyCard from '@/components/ai/settings/AiKeyCard.vue'
import AiProviderCard from '@/components/ai/settings/AiProviderCard.vue'
import AiResidencyCard from '@/components/ai/settings/AiResidencyCard.vue'
import AiRetentionCard from '@/components/ai/settings/AiRetentionCard.vue'
import AiUsageCard from '@/components/ai/settings/AiUsageCard.vue'
import { useAiMonitoring, useAiSettings, useAiTenantConfig } from '@/composables/ai/useAiSettings'

// The tenant's AI settings (spec 2026-11-04 §6.7-6.9): whose provider runs the AI, the residency consent, how long
// conversations are kept, and this month's use. Every part needs `ai.settings.manage`; the server checks it again.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('ai')
const allowed = computed(() => parts.value.length > 0)
const settings = useAiSettings(allowed)
const config = useAiTenantConfig(allowed)
const monitoring = useAiMonitoring(() => shows('usage'))

async function reloadSettings() {
  const result = await settings.refetch()
  if (result.isError || !result.data) throw result.error ?? new Error(t('errors.generic'))
  return result.data
}
async function reloadConfig() {
  const result = await config.refetch()
  if (result.isError || !result.data) throw result.error ?? new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('ai.settings.title')" :description="t('ai.settings.description')" />
    <SharedForbiddenState v-if="!allowed" :description="t('errors.forbidden')" />
    <SharedPageState v-else-if="!settings.data.value" :loading="settings.isLoading.value" :error="settings.error.value" :empty="true" @retry="settings.refetch()" />
    <template v-else>
      <template v-if="shows('provider')">
        <AiProviderCard :settings="settings.data.value" :reload-settings="reloadSettings" />
        <AiKeyCard v-if="config.data.value" :config="config.data.value" />
        <SharedPageState v-else :loading="config.isLoading.value" :error="config.error.value" :empty="true" @retry="config.refetch()" />
      </template>
      <AiResidencyCard v-if="shows('residency')" :settings="settings.data.value" :config="config.data.value" />
      <AiRetentionCard v-if="shows('retention') && config.data.value" :config="config.data.value" :reload-config="reloadConfig" />
      <AiUsageCard v-if="shows('usage')" :settings="settings.data.value" :monitoring="monitoring.data.value" />
    </template>
  </SharedSettingsPage>
</template>
