<script setup lang="ts">
import ChatAttachment from '@/components/chat/ChatAttachment.vue'
import { ApiError } from '@/composables/useApi'
import { CHAT_PAGE_SIZE, nextListOffset, parseChatListRoute, serializeChatListRoute } from '@/utils/chatState'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'

const { t } = useI18n()
const toast = useToast()
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

function seedConversationName(value: typeof conversation.value) {
  const conversationName = value?.name
  if (!conversationName) return
  name.value = conversationName
}
watch(() => conversation.value?.name, (value) => {
  if (value) name.value = value
}, { immediate: true })
useSsrQuerySeed({ data: conversation }, seedConversationName)

const canManage = computed(() => Boolean(conversation.value?.can_manage))
const canLeave = computed(() => conversation.value?.type === 'group' || conversation.value?.type === 'channel')

async function runAction(work: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  try {
    await work()
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('chat.actionFailed'), color: 'error' })
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
    <section class="space-y-6">
      <SharedFormSection v-if="canManage" :title="t('chat.rename')">
        <div class="flex flex-wrap gap-2">
          <UInput v-model="name" class="min-w-0 flex-1" :disabled="!hydrated || busy" />
          <UButton type="button" :disabled="!hydrated || busy" :label="t('chat.save')" @click="saveName" />
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('chat.notifications')">
        <div class="flex flex-wrap gap-2">
          <UButton type="button" size="sm" :color="conversation?.muted ? 'primary' : 'secondary'" :variant="conversation?.muted ? 'solid' : 'outline'" :disabled="!hydrated || busy" :label="t('chat.muted')" @click="toggleMute" />
          <UButton type="button" size="sm" :color="conversation?.notifications === 'all' ? 'primary' : 'secondary'" :variant="conversation?.notifications === 'all' ? 'solid' : 'outline'" :disabled="!hydrated || busy" :label="t('chat.notificationsAll')" @click="setNotifications('all')" />
          <UButton type="button" size="sm" :color="conversation?.notifications === 'mentions' ? 'primary' : 'secondary'" :variant="conversation?.notifications === 'mentions' ? 'solid' : 'outline'" :disabled="!hydrated || busy" :label="t('chat.notificationsMentions')" @click="setNotifications('mentions')" />
          <UButton type="button" size="sm" :color="conversation?.notifications === 'no_notif' ? 'primary' : 'secondary'" :variant="conversation?.notifications === 'no_notif' ? 'solid' : 'outline'" :disabled="!hydrated || busy" :label="t('chat.notificationsNone')" @click="setNotifications('no_notif')" />
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('chat.members')">
        <ul v-if="members?.items.length" class="grid gap-2">
          <li v-for="member in members.items" :key="member.id" class="rounded-lg ring ring-default bg-default overflow-hidden flex items-center justify-between gap-2 p-3 text-start">
            <span>{{ member.name }}{{ member.im_status === 'online' ? ` · ${t('chat.online')}` : '' }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-muted">{{ t('chat.noMembers') }}</p>
        <nav v-if="(members?.total ?? 0) > CHAT_PAGE_SIZE" class="mt-2 flex items-center justify-between text-sm text-muted">
          <UButton type="button" color="neutral" variant="ghost" :disabled="!hydrated || memberOffset === 0" :label="t('chat.previousPage')" @click="memberOffset = nextListOffset(memberOffset, members?.total ?? 0, -CHAT_PAGE_SIZE)" />
          <UButton type="button" color="neutral" variant="ghost" :disabled="!hydrated || memberOffset + CHAT_PAGE_SIZE >= (members?.total ?? 0)" :label="t('chat.nextPage')" @click="memberOffset = nextListOffset(memberOffset, members?.total ?? 0, CHAT_PAGE_SIZE)" />
        </nav>
        <div v-if="canManage" class="mt-3 grid gap-2">
          <UFormField :label="t('chat.addMember')" name="recipientSearch">
            <UInput v-model="recipientQ" class="w-full" :placeholder="t('chat.recipientSearch')" :disabled="!hydrated || busy" />
          </UFormField>
          <ul class="max-h-40 overflow-y-auto rounded-md border">
            <li v-for="person in recipients?.items ?? []" :key="person.id">
              <UButton type="button" color="neutral" variant="ghost" class="w-full justify-start px-3 py-2 text-start" :disabled="!hydrated || busy" :label="person.name" @click="add(person.id)" />
            </li>
          </ul>
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('chat.attachments')">
        <div v-if="attachments?.items.length" class="flex flex-col gap-2">
          <ChatAttachment v-for="attachment in attachments.items" :key="attachment.id" :attachment="attachment" />
        </div>
        <p v-else class="text-sm text-muted">{{ t('chat.noAttachments') }}</p>
        <nav v-if="(attachments?.total ?? 0) > CHAT_PAGE_SIZE" class="mt-2 flex items-center justify-between text-sm text-muted">
          <UButton type="button" color="neutral" variant="ghost" :disabled="!hydrated || fileOffset === 0" :label="t('chat.previousPage')" @click="fileOffset = nextListOffset(fileOffset, attachments?.total ?? 0, -CHAT_PAGE_SIZE)" />
          <UButton type="button" color="neutral" variant="ghost" :disabled="!hydrated || fileOffset + CHAT_PAGE_SIZE >= (attachments?.total ?? 0)" :label="t('chat.nextPage')" @click="fileOffset = nextListOffset(fileOffset, attachments?.total ?? 0, CHAT_PAGE_SIZE)" />
        </nav>
      </SharedFormSection>
      <div v-if="canLeave" class="flex justify-end gap-2">
        <UButton v-if="!leaving" type="button" color="primary" variant="outline" :disabled="!hydrated || busy" :label="t('chat.leave')" @click="leaving = true" />
        <template v-else>
          <UButton type="button" color="error" :disabled="!hydrated || busy" :label="t('chat.confirmLeave')" @click="confirmLeave" />
          <UButton type="button" color="neutral" variant="ghost" :disabled="busy" :label="t('app.cancel')" @click="leaving = false" />
        </template>
      </div>
    </section>
  </SharedPageContainer>
</template>
