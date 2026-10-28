<script setup lang="ts">
import InboxWorkspace from '@/components/inbox/InboxWorkspace.vue'

// /inbox/:id and /inbox/:id/info are one page, so the thread is not remounted when the contact panel opens (a draft and
// the scroll position survive on wide screens). Any other segment is a 404.
definePageMeta({
  key: route => `inbox-${String(route.params.id)}`,
  validate: route => route.params.panel === undefined || route.params.panel === '' || route.params.panel === 'info',
})
const { t } = useI18n()
const route = useRoute()
const conversationId = computed(() => Number(route.params.id))
const infoOpen = computed(() => route.params.panel === 'info')
const validId = computed(() => Number.isSafeInteger(conversationId.value) && conversationId.value > 0)
</script>

<template>
  <InboxWorkspace v-if="validId" :conversation-id="conversationId" :info-open="infoOpen" />
  <SharedPageContainer v-else width="list" data-testid="inbox-not-found">
    <SharedPageHeader :title="t('inbox.title')" back-to="/inbox" :back-label="t('inbox.title')" />
    <SharedNotFoundState back-to="/inbox" :back-label="t('inbox.title')" />
  </SharedPageContainer>
</template>
