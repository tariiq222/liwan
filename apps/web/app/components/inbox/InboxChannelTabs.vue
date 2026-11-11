<script setup lang="ts">
import type { InboxChannelKind } from '@liwan/contracts'
import { channelTabPath, channelTabs } from '@/composables/inbox/inboxChannelKind'

// The sections of one channel in channel administration: a WhatsApp number's number health, business profile and
// templates, or a TikTok account's automation, suggested questions and chat prompts, and history import. The list
// follows the kind; the templates and flows pages of a channel are reached from its details actions, as before.
const props = defineProps<{ channelId: number; kind: InboxChannelKind }>()
const route = useRoute()
const { t } = useI18n()
const current = computed(() => {
  const path = route.path.replace(/\/+$/, '')
  return channelTabs(props.kind).find(tab => tab !== 'details' && path.endsWith(`/${tab}`)) ?? 'details'
})
const items = computed(() => channelTabs(props.kind).map(id => ({
  key: `inbox-channel-tab-${id}`,
  label: t(`inbox.channelTabs.${id}`),
  to: channelTabPath(props.channelId, id),
  active: current.value === id,
})))
</script>

<template>
  <SharedRouteTabs :items="items" :ariaLabel="t('inbox.channelTabs.label')" />
</template>
