<script setup lang="ts">
import ChatAttachment from '@/components/chat/ChatAttachment.vue'
import { CHAT_PAGE_SIZE, nextListOffset, parseChatListRoute, serializeChatListRoute } from '@/utils/chatState'

const { t } = useI18n()
const hydrated = useHydrated()
const route = useRoute()
const conversationId = computed(() => Number(route.params.id))
const listQuery = computed(() => serializeChatListRoute(parseChatListRoute(route.query)))
const memberOffset = ref(0)
const fileOffset = ref(0)
const { data: conversation } = useChatConversation(conversationId)
const { data: members } = useChatMembers(conversationId, memberOffset)
const { data: attachments } = useChatAttachments(conversationId, fileOffset)
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader
      :title="conversation?.name || t('chat.info')"
      :description="t('chat.info')"
      :back-to="{ path: `/chat/${conversationId}`, query: listQuery }"
    />
    <section class="nasq-panel nasq-panel-body grid gap-6">
      <div>
        <h2 class="mb-2 text-sm font-semibold">{{ t('chat.members') }}</h2>
        <ul v-if="members?.items.length" class="grid gap-2">
          <li v-for="member in members.items" :key="member.id" class="text-start">{{ member.name }}</li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">{{ t('chat.noMembers') }}</p>
        <div v-if="(members?.total ?? 0) > CHAT_PAGE_SIZE" class="mt-2 flex justify-between">
          <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || memberOffset === 0" @click="memberOffset = nextListOffset(memberOffset, members?.total ?? 0, -CHAT_PAGE_SIZE)">{{ t('chat.previousPage') }}</Button>
          <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || memberOffset + CHAT_PAGE_SIZE >= (members?.total ?? 0)" @click="memberOffset = nextListOffset(memberOffset, members?.total ?? 0, CHAT_PAGE_SIZE)">{{ t('chat.nextPage') }}</Button>
        </div>
      </div>
      <div>
        <h2 class="mb-2 text-sm font-semibold">{{ t('chat.attachments') }}</h2>
        <div v-if="attachments?.items.length" class="flex flex-col gap-2">
          <ChatAttachment v-for="attachment in attachments.items" :key="attachment.id" :attachment="attachment" />
        </div>
        <p v-else class="text-sm text-muted-foreground">{{ t('chat.noAttachments') }}</p>
        <div v-if="(attachments?.total ?? 0) > CHAT_PAGE_SIZE" class="mt-2 flex justify-between">
          <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || fileOffset === 0" @click="fileOffset = nextListOffset(fileOffset, attachments?.total ?? 0, -CHAT_PAGE_SIZE)">{{ t('chat.previousPage') }}</Button>
          <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || fileOffset + CHAT_PAGE_SIZE >= (attachments?.total ?? 0)" @click="fileOffset = nextListOffset(fileOffset, attachments?.total ?? 0, CHAT_PAGE_SIZE)">{{ t('chat.nextPage') }}</Button>
        </div>
      </div>
    </section>
  </SharedPageContainer>
</template>
