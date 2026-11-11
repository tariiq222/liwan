<script setup lang="ts">
import type { InboxChannelKind } from '@liwan/contracts'
import { channelTabPath, channelTabs, visibleChannelTabs } from '@/composables/inbox/inboxChannelKind'
import { useInboxAutomationEnabled, useInboxTemplatesEnabled } from '@/composables/inbox/inboxFeatures'

// The sections of one channel in channel administration: a WhatsApp number's number health, business profile and
// templates, or a TikTok account's automation, suggested questions and chat prompts, and history import. The list
// follows the kind; the templates and flows pages of a channel are reached from its details actions, as before.
// A section is offered only when its capability and its sub-feature are both open: the automation tab used to show to
// a channel manager who could not open it, and a templates tab stayed when the tenant had templates switched off.
const props = defineProps<{ channelId: number; kind: InboxChannelKind }>()
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const templatesOn = useInboxTemplatesEnabled()
const automationOn = useInboxAutomationEnabled()
const tabs = computed(() => visibleChannelTabs(props.kind, {
  templates: templatesOn.value,
  automation: automationOn.value,
  canTemplates: can('inbox.templates.manage'),
  canChannels: can('inbox.channels.manage'),
  canAutomation: can('inbox.automation.manage'),
}))
const current = computed(() => {
  const path = route.path.replace(/\/+$/, '')
  return channelTabs(props.kind).find(tab => tab !== 'details' && path.endsWith(`/${tab}`)) ?? 'details'
})
const items = computed(() => tabs.value.map(id => ({
  key: `inbox-channel-tab-${id}`,
  label: t(`inbox.channelTabs.${id}`),
  to: channelTabPath(props.channelId, id),
  active: current.value === id,
})))
</script>

<template>
  <SharedRouteTabs :items="items" :ariaLabel="t('inbox.channelTabs.label')" />
</template>
