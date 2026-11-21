<script setup lang="ts">
import InboxCampaignSettingsCard from '@/components/inbox/campaigns/InboxCampaignSettingsCard.vue'
import InboxAgentsSection from '@/components/inbox/InboxAgentsSection.vue'
import InboxAutoMessagesSection from '@/components/inbox/InboxAutoMessagesSection.vue'
import InboxCannedRepliesSection from '@/components/inbox/InboxCannedRepliesSection.vue'
import InboxChannelsSection from '@/components/inbox/InboxChannelsSection.vue'
import InboxDepartmentsSection from '@/components/inbox/InboxDepartmentsSection.vue'
import InboxPolicyCard from '@/components/inbox/InboxPolicyCard.vue'
import InboxPresets from '@/components/inbox/InboxPresets.vue'
import InboxTagsSection from '@/components/inbox/InboxTagsSection.vue'
import { useInboxCampaignSettings, useInboxCampaignsEnabled } from '@/composables/inbox/useInboxCampaigns'
import { useInboxSettings } from '@/composables/inbox/useInboxSettings'

// The inbox application's settings under Settings > Applications: the presets, then one tab per manifest group (hidden
// tabs stay mounted, so a draft survives a tab switch). A card shows only when the user holds its capability
// (useSettingsPage). The policy and campaign cards are value cards: each saves only its own fields through the page's one
// save bar, and their draft survives a tab switch because hidden tabs stay mounted (v-show). A channel has a page of its own, and connecting one is the create panel
// over this page, so the cards stay behind it. A channel's templates pages are channel pages too; the working hours, a
// channel's automatic messages and the rules (with their create panel) are pages of the automation area; the catalog
// (its connect and item create panels included) is a sub-page tree of its own.
const route = useRoute()
const { t } = useI18n()
const { shows, tabItems, activeTab } = useSettingsPage('inbox')
const { can } = useAccess()
const campaignsOn = useInboxCampaignsEnabled()
const policy = useInboxSettings(() => shows('policy'))
const campaigns = useInboxCampaignSettings(() => shows('campaigns') && campaignsOn.value)
async function reload<T>(query: { refetch: () => Promise<{ data?: T; isError: boolean; error: unknown }> }): Promise<T> {
  const result = await query.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isSubPage = computed(() => /^\/settings\/apps\/inbox\/(?:channels\/(?!new$)[^/]+|auto-messages|rules|working-hours|templates|flows|catalog)(?:\/|$)/.test(normalizedPath.value))
</script>

<template>
  <NuxtPage v-if="isSubPage" />
  <template v-else>
    <SharedSettingsPage>
      <SharedPageHeader :title="t('inbox.title')" />
      <div class="grid gap-(--liwan-gap-card)" data-testid="inbox-settings">
        <InboxPresets v-if="shows('presets')" />
        <SharedRouteTabs :items="tabItems" :ariaLabel="t('inbox.settings.groups.label')" />
        <div v-show="activeTab === 'basics'" class="grid gap-(--liwan-gap-card)" data-testid="settings-panel-basics">
          <SharedPageState v-if="shows('policy')" :loading="policy.isLoading.value" :error="policy.data.value ? null : policy.error.value" @retry="policy.refetch">
            <InboxPolicyCard v-if="policy.data.value" :settings="policy.data.value" :can-edit="can('inbox.settings.manage')" :reload-settings="() => reload(policy)" />
          </SharedPageState>
          <InboxDepartmentsSection v-if="shows('departments')" />
          <InboxAgentsSection v-if="shows('agents')" />
          <InboxTagsSection v-if="shows('tags')" />
        </div>
        <div v-show="activeTab === 'replies'" class="grid gap-(--liwan-gap-card)" data-testid="settings-panel-replies">
          <InboxCannedRepliesSection v-if="shows('canned-replies')" />
          <InboxAutoMessagesSection v-if="shows('auto-messages')" />
          <SharedPageState v-if="shows('campaigns') && campaignsOn" :loading="campaigns.isLoading.value" :error="campaigns.data.value ? null : campaigns.error.value" @retry="campaigns.refetch">
            <InboxCampaignSettingsCard v-if="campaigns.data.value" :settings="campaigns.data.value" :can-edit="can('inbox.campaigns.manage')" :reload-settings="() => reload(campaigns)" />
          </SharedPageState>
        </div>
        <div v-show="activeTab === 'channels'" class="grid gap-(--liwan-gap-card)" data-testid="settings-panel-channels">
          <InboxChannelsSection v-if="shows('channels')" />
        </div>
      </div>
    </SharedSettingsPage>
    <NuxtPage />
  </template>
</template>
