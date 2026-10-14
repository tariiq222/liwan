<script setup lang="ts">
import ChatWorkspace from '@/components/chat/ChatWorkspace.vue'

// /chat/:id and /chat/:id/info are one page, so the thread is not remounted when the info panel opens (a draft and the
// scroll position survive on wide screens). Any other segment is a 404.
definePageMeta({
  key: route => `chat-${String(route.params.id)}`,
  validate: route => route.params.panel === undefined || route.params.panel === '' || route.params.panel === 'info',
})
const route = useRoute()
const conversationId = computed(() => Number(route.params.id))
const infoOpen = computed(() => route.params.panel === 'info')
</script>

<template>
  <ChatWorkspace v-if="Number.isSafeInteger(conversationId) && conversationId > 0" :conversation-id="conversationId" :info-open="infoOpen" />
</template>
