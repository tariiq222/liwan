<script setup lang="ts">
import InboxFlowSubmissionCard from '@/components/inbox/InboxFlowSubmissionCard.vue'
import { conversationRoute } from '@/composables/inbox/inboxFlow'
import { useInboxConversationFlowSubmissions } from '@/composables/inbox/useInboxFlows'

// The «forms» section of the contact panel: the forms this customer completed in the conversation, newest first, each
// with a link to the message of the answer. Nothing is shown while there are none, or when the list is not available
// to this user (the panel is useful without it).
const props = defineProps<{ conversationId: number }>()
const { t } = useI18n()
const route = useRoute()
const query = useInboxConversationFlowSubmissions(() => props.conversationId)
const items = computed(() => query.data.value?.items ?? [])
const link = (messageId: number) => conversationRoute(props.conversationId, messageId, route.query)
</script>

<template>
  <SharedRecordSection v-if="items.length" variant="panel" :title="t('inbox.flows.panel.title')" data-testid="inbox-flow-submissions">
    <ul class="flex flex-col gap-3">
      <li v-for="submission in items" :key="submission.id" class="rounded-control p-3 ring ring-default">
        <InboxFlowSubmissionCard :submission="submission" show-time :link="link(submission.message_id)" :link-label="t('inbox.flows.panel.openMessage')" />
      </li>
    </ul>
  </SharedRecordSection>
</template>
