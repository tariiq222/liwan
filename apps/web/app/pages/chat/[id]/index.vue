<script setup lang="ts">
import ChatWorkspace from '@/components/chat/ChatWorkspace.vue'

const route = useRoute()
const conversationId = computed(() => Number(route.params.id))
</script>

<template>
  <ChatWorkspace v-if="Number.isSafeInteger(conversationId) && conversationId > 0" :conversation-id="conversationId" />
</template>
