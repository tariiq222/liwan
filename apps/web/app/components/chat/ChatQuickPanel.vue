<script setup lang="ts">
import { useChatConversations } from '@/composables/useChat'

// The chat manifest's top-bar panel (AppManifest.quickPanel): the latest conversations, unread ones tinted.
const PANEL_ROWS = 6
const { t } = useI18n()
const { data, isLoading, error, refetch } = useChatConversations({ q: '', filter: 'all', offset: 0 })
const rows = computed(() => (data.value?.items ?? []).slice(0, PANEL_ROWS))
// A channel name carries its own `#`; the avatar letter is the first letter after it.
const initial = (name: string) => Array.from(name.replace(/^#/, ''))[0] ?? '?'
</script>

<template>
  <div data-testid="chat-quick-panel">
    <ShellPanelStatus v-if="error" kind="error" :message="t('nav.panel.error')" :retry-label="t('nav.panel.retry')" @retry="refetch()" />
    <ShellPanelStatus v-else-if="isLoading" kind="loading" :message="t('nav.panel.loading')" />
    <ShellPanelStatus v-else-if="!rows.length" kind="empty" :message="t('nav.panel.chatEmpty')" />
    <template v-else>
      <ShellPanelRow
        v-for="conversation in rows"
        :key="conversation.id"
        :to="`/chat/${conversation.id}`"
        :lead="initial(conversation.name)"
        :title="conversation.name"
        :caption="conversation.last_message_preview ?? undefined"
        :unread="conversation.unread_count > 0"
        :test-id="`chat-quick-${conversation.id}`"
      />
    </template>
  </div>
</template>
