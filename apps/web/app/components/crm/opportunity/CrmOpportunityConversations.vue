<script setup lang="ts">
import type { InboxConversation } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'

// The customer conversations linked to one opportunity (the CRM bridge to the inbox): who wrote, on which channel, the
// state and the last message, each linking to the conversation in the inbox workspace. Read only: a conversation is
// linked from the inbox, never from here.
const props = defineProps<{ conversations: InboxConversation[]; total: number; loading?: boolean; error?: unknown }>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
const STATE_TONE = { open: 'info', pending: 'warning', resolved: 'success', closed: 'neutral' } as const
const nameOf = (conversation: InboxConversation) => (conversation.contact.erased ? t('crm.opportunities.conversations.erased') : conversation.contact.name)
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('crm.opportunities.conversations.title')" data-testid="crm-conversations">
    <SharedPageState :loading="props.loading" :error="props.error" :empty="!props.conversations.length" :empty-text="t('crm.opportunities.conversations.empty')" @retry="emit('retry')">
      <ul class="divide-y divide-default" data-testid="crm-conversation-list">
        <li v-for="conversation in props.conversations" :key="conversation.id" class="grid gap-1 py-3 first:pt-0 last:pb-0">
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <NuxtLink :to="`/inbox/${conversation.id}`" class="min-w-0 truncate font-semibold text-primary hover:underline">{{ nameOf(conversation) }}</NuxtLink>
            <SharedStatusBadge :tone="STATE_TONE[conversation.state]" :label="t(`crm.opportunities.conversations.state.${conversation.state}`)" size="sm" />
            <span v-if="conversation.unread" class="text-xs text-primary">{{ t('crm.opportunities.conversations.unread') }}</span>
          </div>
          <p class="flex min-w-0 flex-wrap gap-x-3 text-sm text-muted">
            <span>{{ conversation.channel.name }}</span>
            <time v-if="conversation.last_message_at" :datetime="conversation.last_message_at">{{ formatDateTime(conversation.last_message_at) }}</time>
          </p>
          <p v-if="conversation.last_message_preview" class="line-clamp-2 break-words text-sm">{{ conversation.last_message_preview }}</p>
        </li>
      </ul>
      <p v-if="props.total > props.conversations.length" class="mt-3 border-t border-default pt-3 text-sm text-muted">{{ t('crm.opportunities.conversations.count', { shown: props.conversations.length, total: props.total }) }}</p>
    </SharedPageState>
  </SharedRecordSection>
</template>
