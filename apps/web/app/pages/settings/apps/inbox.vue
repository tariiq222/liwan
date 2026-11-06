<script setup lang="ts">
import InboxCampaignSettingsForm from '@/components/inbox/campaigns/InboxCampaignSettingsForm.vue'
import InboxAutoMessagesSection from '@/components/inbox/InboxAutoMessagesSection.vue'
import InboxCannedRepliesSection from '@/components/inbox/InboxCannedRepliesSection.vue'
import InboxChannelsSection from '@/components/inbox/InboxChannelsSection.vue'
import InboxDepartmentsSection from '@/components/inbox/InboxDepartmentsSection.vue'
import { useInboxCampaignsEnabled } from '@/composables/inbox/useInboxCampaigns'
import InboxPolicyForm from '@/components/inbox/InboxPolicyForm.vue'
import InboxPresets from '@/components/inbox/InboxPresets.vue'
import InboxTagsSection from '@/components/inbox/InboxTagsSection.vue'

// The inbox application's settings under Settings > Applications: the presets, then one tab per manifest group (hidden
// tabs stay mounted, so a draft survives a tab switch). A card shows only when the user holds its capability
// (useSettingsPage). A channel has a page of its own, and connecting one is the create panel
// over this page, so the cards stay behind it. A channel's templates pages are channel pages too; the working hours, a
// channel's automatic messages and the rules (with their create panel) are pages of the automation area; the catalog
// (its connect and item create panels included) is a sub-page tree of its own.
const route = useRoute()
const { t } = useI18n()
const { shows, tabItems, activeTab } = useSettingsPage('inbox')
const campaignsOn = useInboxCampaignsEnabled()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isSubPage = computed(() => /^\/settings\/apps\/inbox\/(?:channels\/(?!new$)[^/]+|auto-messages|rules|working-hours|catalog)(?:\/|$)/.test(normalizedPath.value))
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
          <InboxPolicyForm v-if="shows('policy')" />
          <InboxDepartmentsSection v-if="shows('departments')" />
          <InboxTagsSection v-if="shows('tags')" />
        </div>
        <div v-show="activeTab === 'replies'" class="grid gap-(--liwan-gap-card)" data-testid="settings-panel-replies">
          <InboxCannedRepliesSection v-if="shows('canned-replies')" />
          <InboxAutoMessagesSection v-if="shows('auto-messages')" />
          <InboxCampaignSettingsForm v-if="shows('campaigns') && campaignsOn" />
        </div>
        <div v-show="activeTab === 'channels'" class="grid gap-(--liwan-gap-card)" data-testid="settings-panel-channels">
          <InboxChannelsSection v-if="shows('channels')" />
        </div>
      </div>
    </SharedSettingsPage>
    <NuxtPage />
  </template>
</template>
