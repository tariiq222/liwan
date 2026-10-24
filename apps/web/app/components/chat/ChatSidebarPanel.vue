<script setup lang="ts">
import ConversationList from '@/components/chat/ConversationList.vue'
import { parseChatListRoute, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'

// The chat manifest's context-sidebar panel (AppManifest.sidebarPanel): the
// conversation list beside the open thread. The shell renders it without
// naming chat (R3); the panel owns its own list state in the URL.
const route = useRoute()
const router = useRouter()
const routeState = computed(() => parseChatListRoute(route.query))
const selectedId = computed(() => {
  const id = Number(route.path.match(/^\/chat\/(\d+)(?:\/|$)/)?.[1])
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
})

function updateRoute(next: ChatListRoute) {
  const creating = (route.path.replace(/\/+$/, '') || '/') === '/chat/new'
  void router.replace({ path: route.path, query: { ...(creating ? route.query : {}), ...serializeChatListRoute(next) } })
}
</script>

<template>
  <ConversationList class="min-h-0 flex-1" :route-state="routeState" :selected-id="selectedId" @update:route-state="updateRoute" />
</template>
