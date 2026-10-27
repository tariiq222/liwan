<script setup lang="ts">
import ChatWorkspace from '@/components/chat/ChatWorkspace.vue'

// /chat/:id and /chat/:id/info are one page, so the thread is not remounted when the info panel opens (a draft and the
// scroll position survive on wide screens). Any other segment is a 404.
definePageMeta({
  key: route => `chat-${String(route.params.id)}`,
  validate: route => route.params.panel === undefined || route.params.panel === '' || route.params.panel === 'info',
})
const { t } = useI18n()
const route = useRoute()
const conversationId = computed(() => Number(route.params.id))
const infoOpen = computed(() => route.params.panel === 'info')
const validId = computed(() => Number.isSafeInteger(conversationId.value) && conversationId.value > 0)
</script>

<template>
  <ChatWorkspace v-if="validId" :conversation-id="conversationId" :info-open="infoOpen" />
  <SharedPageContainer v-else width="list" data-testid="chat-not-found">
    <SharedPageHeader :title="t('chat.title')" back-to="/chat" :back-label="t('chat.title')" />
    <SharedNotFoundState back-to="/chat" :back-label="t('chat.title')" />
  </SharedPageContainer>
</template>
