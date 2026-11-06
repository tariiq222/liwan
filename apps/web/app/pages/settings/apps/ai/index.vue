<script setup lang="ts">
import AiAgentCard from '@/components/ai/settings/AiAgentCard.vue'
import AiCompanyMemoryCard from '@/components/ai/settings/AiCompanyMemoryCard.vue'
import AiKnowledgeCard from '@/components/ai/settings/AiKnowledgeCard.vue'
import AiKeyCard from '@/components/ai/settings/AiKeyCard.vue'
import AiPolicyCard from '@/components/ai/settings/AiPolicyCard.vue'
import AiProviderCard from '@/components/ai/settings/AiProviderCard.vue'
import AiConsentCard from '@/components/ai/settings/AiConsentCard.vue'
import AiRetentionCard from '@/components/ai/settings/AiRetentionCard.vue'
import AiUsageCard from '@/components/ai/settings/AiUsageCard.vue'
import { useAiAgentSettings, useAiMonitoring, useAiSettings, useAiTenantConfig } from '@/composables/ai/useAiSettings'
import { useAdminRoles } from '@/composables/useAdminRoles'
import { ApiError } from '@/composables/useApi'

// The tenant's AI settings (spec 2026-11-04 §6.7-6.9): whose provider runs the AI, the use acknowledgement, how long
// conversations are kept, what each agent may do, and this month's use. Every part needs `ai.settings.manage`; the
// server checks it again. Limiting an agent to some roles also needs the role catalog (`access.roles.read`).
const { t } = useI18n()
const { can } = useAccess()
const { parts, shows } = useSettingsPage('ai')
const allowed = computed(() => parts.value.length > 0)
const settings = useAiSettings(allowed)
const tenantForbidden = computed(() => settings.error.value instanceof ApiError && settings.error.value.status === 403)
const config = useAiTenantConfig(allowed)
const monitoring = useAiMonitoring(() => shows('usage'))
// The usage part names the agents too.
const agents = useAiAgentSettings(() => shows('agents') || shows('usage'))
const canReadRoles = computed(() => can('access.roles.read'))
const roles = useAdminRoles({ status: 'active' }, () => shows('agents') && canReadRoles.value)
const roleList = computed(() => (canReadRoles.value ? roles.data.value?.items ?? [] : null))

async function reloadSettings() {
  const result = await settings.refetch()
  if (result.isError || !result.data) throw result.error ?? new Error(t('errors.generic'))
  return result.data
}
async function reloadAgents() {
  const result = await agents.refetch()
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
    <SharedPageHeader :title="t('ai.settings.title')" :description="t('ai.settings.description')">
      <template #actions>
        <UButton v-if="allowed" :to="{ path: '/ai', query: { mode: 'setup' } }" icon="i-lucide-wand-sparkles" :label="t('ai.setup.open')" data-testid="ai-setup-open" />
      </template>
    </SharedPageHeader>
    <SharedForbiddenState v-if="!allowed" :description="t('errors.forbidden')" />
    <template v-else>
      <!-- A manager of a branch company reviews its company notes without the tenant-wide settings of the root company. -->
      <SharedPageState v-if="!settings.data.value && !tenantForbidden" :loading="settings.isLoading.value" :error="settings.error.value" :empty="true" @retry="settings.refetch()" />
      <template v-if="settings.data.value">
        <template v-if="shows('provider')">
          <AiProviderCard :settings="settings.data.value" :reload-settings="reloadSettings" />
          <AiKeyCard v-if="config.data.value" :config="config.data.value" />
          <SharedPageState v-else :loading="config.isLoading.value" :error="config.error.value" :empty="true" @retry="config.refetch()" />
        </template>
        <AiConsentCard v-if="shows('consent')" :settings="settings.data.value" />
        <AiRetentionCard v-if="shows('retention') && config.data.value" :config="config.data.value" :reload-config="reloadConfig" />
        <template v-if="shows('agents')">
          <AiPolicyCard :settings="settings.data.value" :reload-settings="reloadSettings" />
          <template v-if="agents.data.value">
            <AiAgentCard v-for="agent in agents.data.value.items" :key="agent.key" :agent="agent" :roles="roleList" :reload-agents="reloadAgents" />
            <SharedEmptyState v-if="!agents.data.value.items.length" :title="t('ai.settings.agents.empty')" />
          </template>
          <SharedPageState v-else :loading="agents.isLoading.value" :error="agents.error.value" :empty="true" @retry="agents.refetch()" />
        </template>
        <AiKnowledgeCard v-if="shows('knowledge')" :settings="settings.data.value" :reload-settings="reloadSettings" />
      </template>
      <AiCompanyMemoryCard v-if="shows('memory')" />
      <AiUsageCard v-if="shows('usage') && settings.data.value" :settings="settings.data.value" :monitoring="monitoring.data.value" :agents="agents.data.value" />
    </template>
  </SharedSettingsPage>
</template>
