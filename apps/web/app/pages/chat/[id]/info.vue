<script setup lang="ts">
import { toast } from 'vue-sonner'
import ChatAttachment from '@/components/chat/ChatAttachment.vue'
import { ApiError } from '@/composables/useApi'
import { CHAT_PAGE_SIZE, nextListOffset, parseChatListRoute, serializeChatListRoute } from '@/utils/chatState'

const { t } = useI18n()
const hydrated = useHydrated()
const route = useRoute()
const conversationId = computed(() => Number(route.params.id))
const listQuery = computed(() => serializeChatListRoute(parseChatListRoute(route.query)))
const memberOffset = ref(0)
const fileOffset = ref(0)
const name = ref('')
const recipientQ = ref('')
const leaving = ref(false)
const busy = ref(false)
const { data: conversation } = useChatConversation(conversationId)
const { data: members } = useChatMembers(conversationId, memberOffset)
const { data: attachments } = useChatAttachments(conversationId, fileOffset)
const { data: recipients } = useChatRecipients(recipientQ)
const { mutateAsync: patch } = usePatchConversation(conversationId)
const { mutateAsync: addMembers } = useAddChatMembers(conversationId)
const { mutateAsync: leave } = useLeaveConversation(conversationId)

watch(() => conversation.value?.name, (value) => {
  if (value) name.value = value
}, { immediate: true })

const canManage = computed(() => Boolean(conversation.value?.can_manage))
const canLeave = computed(() => conversation.value?.type === 'group' || conversation.value?.type === 'channel')

async function runAction(work: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  try {
    await work()
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('chat.actionFailed'))
  } finally {
    busy.value = false
  }
}

async function saveName() {
  if (!name.value.trim() || name.value === conversation.value?.name) return
  await runAction(() => patch({ name: name.value.trim() }))
}

async function toggleMute() {
  await runAction(() => patch({ muted: !conversation.value?.muted }))
}

async function setNotifications(value: 'all' | 'mentions' | 'no_notif' | null) {
  await runAction(() => patch({ notifications: value }))
}

async function add(userId: number) {
  await runAction(async () => {
    await addMembers({ user_ids: [userId] })
    recipientQ.value = ''
  })
}

async function confirmLeave() {
  await runAction(async () => {
    await leave()
    await navigateTo({ path: '/chat', query: listQuery.value })
  })
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader
      :title="conversation?.name || t('chat.info')"
      :back-to="{ path: `/chat/${conversationId}`, query: listQuery }"
    />
    <section class="nasq-form nasq-panel nasq-panel-body grid gap-6">
      <SharedFormSection v-if="canManage" :title="t('chat.rename')">
        <div class="flex gap-2">
          <Input v-model="name" :disabled="!hydrated || busy" />
          <Button type="button" size="sm" :disabled="!hydrated || busy" @click="saveName">{{ t('chat.save') }}</Button>
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('chat.notifications')">
        <div class="flex flex-wrap gap-2">
          <Button type="button" size="sm" :variant="conversation?.muted ? 'default' : 'outline'" :disabled="!hydrated || busy" @click="toggleMute">{{ t('chat.muted') }}</Button>
          <Button type="button" size="sm" :variant="conversation?.notifications === 'all' ? 'default' : 'outline'" :disabled="!hydrated || busy" @click="setNotifications('all')">{{ t('chat.notificationsAll') }}</Button>
          <Button type="button" size="sm" :variant="conversation?.notifications === 'mentions' ? 'default' : 'outline'" :disabled="!hydrated || busy" @click="setNotifications('mentions')">{{ t('chat.notificationsMentions') }}</Button>
          <Button type="button" size="sm" :variant="conversation?.notifications === 'no_notif' ? 'default' : 'outline'" :disabled="!hydrated || busy" @click="setNotifications('no_notif')">{{ t('chat.notificationsNone') }}</Button>
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('chat.members')">
        <ul v-if="members?.items.length" class="grid gap-2">
          <li v-for="member in members.items" :key="member.id" class="flex items-center justify-between gap-2 text-start">
            <span>{{ member.name }}{{ member.im_status === 'online' ? ` · ${t('chat.online')}` : '' }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">{{ t('chat.noMembers') }}</p>
        <nav v-if="(members?.total ?? 0) > CHAT_PAGE_SIZE" class="mt-2 flex items-center justify-between text-sm text-muted-foreground">
          <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || memberOffset === 0" @click="memberOffset = nextListOffset(memberOffset, members?.total ?? 0, -CHAT_PAGE_SIZE)">{{ t('chat.previousPage') }}</Button>
          <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || memberOffset + CHAT_PAGE_SIZE >= (members?.total ?? 0)" @click="memberOffset = nextListOffset(memberOffset, members?.total ?? 0, CHAT_PAGE_SIZE)">{{ t('chat.nextPage') }}</Button>
        </nav>
        <div v-if="canManage" class="mt-3 grid gap-2">
          <Label>{{ t('chat.addMember') }}</Label>
          <Input v-model="recipientQ" :placeholder="t('chat.recipientSearch')" :disabled="!hydrated || busy" />
          <ul class="max-h-40 overflow-y-auto rounded-md border">
            <li v-for="person in recipients?.items ?? []" :key="person.id">
              <button type="button" class="w-full px-3 py-2 text-start hover:bg-muted" :disabled="!hydrated || busy" @click="add(person.id)">{{ person.name }}</button>
            </li>
          </ul>
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('chat.attachments')">
        <div v-if="attachments?.items.length" class="flex flex-col gap-2">
          <ChatAttachment v-for="attachment in attachments.items" :key="attachment.id" :attachment="attachment" />
        </div>
        <p v-else class="text-sm text-muted-foreground">{{ t('chat.noAttachments') }}</p>
        <nav v-if="(attachments?.total ?? 0) > CHAT_PAGE_SIZE" class="mt-2 flex items-center justify-between text-sm text-muted-foreground">
          <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || fileOffset === 0" @click="fileOffset = nextListOffset(fileOffset, attachments?.total ?? 0, -CHAT_PAGE_SIZE)">{{ t('chat.previousPage') }}</Button>
          <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || fileOffset + CHAT_PAGE_SIZE >= (attachments?.total ?? 0)" @click="fileOffset = nextListOffset(fileOffset, attachments?.total ?? 0, CHAT_PAGE_SIZE)">{{ t('chat.nextPage') }}</Button>
        </nav>
      </SharedFormSection>
      <div v-if="canLeave" class="flex justify-end gap-2">
        <Button v-if="!leaving" type="button" variant="outline" :disabled="!hydrated || busy" @click="leaving = true">{{ t('chat.leave') }}</Button>
        <template v-else>
          <Button type="button" variant="destructive" :disabled="!hydrated || busy" @click="confirmLeave">{{ t('chat.confirmLeave') }}</Button>
          <Button type="button" variant="ghost" :disabled="busy" @click="leaving = false">{{ t('app.cancel') }}</Button>
        </template>
      </div>
    </section>
  </SharedPageContainer>
</template>
