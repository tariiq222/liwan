<script setup lang="ts">
import InboxConversationList from '@/components/inbox/InboxConversationList.vue'
import { parseInboxListRoute, serializeInboxListRoute, type InboxListRoute } from '@/composables/inbox/inboxListRoute'

// The inbox manifest's context-sidebar panel (AppManifest.sidebarPanel): the conversation list beside the open thread.
// The shell renders it without naming the inbox (R3); the list filters stay in the URL query.
const route = useRoute()
const router = useRouter()
const routeState = computed(() => parseInboxListRoute(route.query))
const selectedId = computed(() => {
  const id = Number(route.path.match(/^\/inbox\/(\d+)(?:\/|$)/)?.[1])
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
})

function updateRoute(next: InboxListRoute) {
  void router.replace({ path: route.path, query: serializeInboxListRoute(next) })
}
</script>

<template>
  <InboxConversationList class="min-h-0 flex-1" :route-state="routeState" :selected-id="selectedId" @update:route-state="updateRoute" />
</template>
