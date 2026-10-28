<script setup lang="ts">
import InboxCannedRepliesSection from '@/components/inbox/InboxCannedRepliesSection.vue'
import InboxChannelsSection from '@/components/inbox/InboxChannelsSection.vue'
import InboxDepartmentsSection from '@/components/inbox/InboxDepartmentsSection.vue'
import InboxPolicyForm from '@/components/inbox/InboxPolicyForm.vue'
import InboxPresets from '@/components/inbox/InboxPresets.vue'
import InboxTagsSection from '@/components/inbox/InboxTagsSection.vue'

// The inbox application's settings: one page of cards under Settings > Applications. A card shows only when the user
// holds its capability (useSettingsPage). A channel has a page of its own, and connecting one is the create panel
// over this page, so the cards stay behind it.
const route = useRoute()
const { t } = useI18n()
const { shows } = useSettingsPage('inbox')
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isChannelPage = computed(() => /^\/settings\/apps\/inbox\/channels\/(?!new$)[^/]+$/.test(normalizedPath.value))
</script>

<template>
  <NuxtPage v-if="isChannelPage" />
  <template v-else>
    <SharedSettingsPage width="form">
      <SharedPageHeader :title="t('inbox.title')" />
      <div class="grid gap-(--webvue-gap-card)" data-testid="inbox-settings">
        <InboxPolicyForm v-if="shows('policy')" />
        <InboxPresets v-if="shows('presets')" />
        <InboxDepartmentsSection v-if="shows('departments')" />
        <InboxTagsSection v-if="shows('tags')" />
        <InboxCannedRepliesSection v-if="shows('canned-replies')" />
        <InboxChannelsSection v-if="shows('channels')" />
      </div>
    </SharedSettingsPage>
    <NuxtPage />
  </template>
</template>
