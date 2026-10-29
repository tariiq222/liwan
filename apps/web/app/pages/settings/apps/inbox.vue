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

// The inbox application's settings: one page of cards under Settings > Applications. A card shows only when the user
// holds its capability (useSettingsPage). A channel has a page of its own, and connecting one is the create panel
// over this page, so the cards stay behind it. A channel's templates pages are channel pages too; the working hours, a
// channel's automatic messages and the rules (with their create panel) are pages of the automation area; the catalog
// (its connect and item create panels included) is a sub-page tree of its own.
const route = useRoute()
const { t } = useI18n()
const { shows } = useSettingsPage('inbox')
const campaignsOn = useInboxCampaignsEnabled()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isSubPage = computed(() => /^\/settings\/apps\/inbox\/(?:channels\/(?!new$)[^/]+|auto-messages|rules|working-hours|catalog)(?:\/|$)/.test(normalizedPath.value))
</script>

<template>
  <NuxtPage v-if="isSubPage" />
  <template v-else>
    <SharedSettingsPage width="form">
      <SharedPageHeader :title="t('inbox.title')" />
      <div class="grid gap-(--webvue-gap-card)" data-testid="inbox-settings">
        <InboxPolicyForm v-if="shows('policy')" />
        <InboxPresets v-if="shows('presets')" />
        <InboxDepartmentsSection v-if="shows('departments')" />
        <InboxTagsSection v-if="shows('tags')" />
        <InboxCannedRepliesSection v-if="shows('canned-replies')" />
        <InboxAutoMessagesSection v-if="shows('auto-messages')" />
        <InboxCampaignSettingsForm v-if="shows('campaigns') && campaignsOn" />
        <InboxChannelsSection v-if="shows('channels')" />
      </div>
    </SharedSettingsPage>
    <NuxtPage />
  </template>
</template>
