<script setup lang="ts">
import ChatWorkspace from '@/components/chat/ChatWorkspace.vue'

const route = useRoute()
const isCreateRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/chat/new')
</script>

<template>
  <ChatWorkspace v-if="isCreateRoute" />
  <NuxtPage />
</template>
