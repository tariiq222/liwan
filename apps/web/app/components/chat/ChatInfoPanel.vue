<script setup lang="ts">
import ChatAttachment from '@/components/chat/ChatAttachment.vue'
import { ApiError } from '@/composables/useApi'
import { CHAT_PAGE_SIZE, nextListOffset, parseChatListRoute, serializeChatListRoute } from '@/utils/chatState'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'
import { avatarProps } from '@webvue/ui/app/utils/avatarTone'

// The body of a conversation's info: rename, notifications, members, files and leave. The conversation layout shows it
// in its `info` aside (ChatWorkspace); the info page wraps it for the stand-alone route.
const props = defineProps<{ conversationId: number }>()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const route = useRoute()
const conversationId = computed(() => props.conversationId)
const listQuery = computed(() => serializeChatListRoute(parseChatListRoute(route.query)))
const memberOffset = ref(0)
const fileOffset = ref(0)
const name = ref('')
const recipientQ = ref('')
const leaving = ref(false)
const busy = ref(false)
const { data: conversation } = useChatConversation(conversationId)
const { data: members, isLoading: membersLoading, error: membersError, refetch: refetchMembers } = useChatMembers(conversationId, memberOffset)
const { data: attachments, isLoading: attachmentsLoading, error: attachmentsError, refetch: refetchAttachments } = useChatAttachments(conversationId, fileOffset)
// People are listed only once something is typed, and never the ones already in the conversation.
const searching = computed(() => recipientQ.value.trim().length > 0)
const { data: recipients } = useChatRecipients(() => recipientQ.value.trim(), 0, searching)
const memberIds = computed(() => new Set(members.value?.items.map(member => member.id)))
const candidates = computed(() => searching.value ? (recipients.value?.items ?? []).filter(person => !memberIds.value.has(person.id)) : [])
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

const pageFor = (offset: number) => Math.floor(offset / CHAT_PAGE_SIZE) + 1
const pagesFor = (total: number | undefined) => Math.max(1, Math.ceil((total ?? 0) / CHAT_PAGE_SIZE))
const offsetFor = (page: number, total: number | undefined) => nextListOffset(0, total ?? 0, (page - 1) * CHAT_PAGE_SIZE)
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

type NotificationChoice = 'muted' | 'all' | 'mentions' | 'no_notif'
const notificationChoice = computed(() => conversation.value?.muted ? 'muted' : conversation.value?.notifications ?? '')
const notificationItems = computed(() => [
  { value: 'muted', label: t('chat.muted') },
  { value: 'all', label: t('chat.notificationsAll') },
  { value: 'mentions', label: t('chat.notificationsMentions') },
  { value: 'no_notif', label: t('chat.notificationsNone') },
])

async function setNotifications(choice: NotificationChoice) {
  if (choice === 'muted') return runAction(() => patch({ muted: true }))
  await runAction(() => patch(conversation.value?.muted ? { muted: false, notifications: choice } : { notifications: choice }))
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
  <section class="space-y-4" data-testid="chat-info">
    <SharedRecordSection v-if="canManage" variant="panel" :title="t('chat.rename')">
      <div class="flex flex-wrap gap-2">
        <UInput v-model="name" class="min-w-0 flex-1" :disabled="!hydrated || busy" />
        <UButton type="button" :disabled="!hydrated || busy" :label="t('chat.save')" @click="saveName" />
      </div>
    </SharedRecordSection>
    <SharedRecordSection variant="panel" :title="t('chat.notifications')">
      <SharedSegmentedControl
        block
        :model-value="notificationChoice"
        :items="notificationItems"
        :label="t('chat.notifications')"
        :disabled="busy"
        @update:model-value="setNotifications($event as NotificationChoice)"
      />
    </SharedRecordSection>
    <SharedRecordSection variant="list" :title="t('chat.members')">
      <SharedPageState :loading="membersLoading || !hydrated" :error="membersError" :empty="!members?.items.length" :empty-text="t('chat.noMembers')" @retry="refetchMembers()">
        <div v-for="member in members?.items" :key="member.id" class="flex items-center gap-3 p-3 text-start">
          <UAvatar v-bind="avatarProps(member.name, member.id)" size="md" />
          <span class="min-w-0 flex-1 truncate">{{ member.name }}{{ member.im_status === 'online' ? ` · ${t('chat.online')}` : '' }}</span>
        </div>
      </SharedPageState>
      <div v-if="pagesFor(members?.total) > 1" class="p-3"><SharedPagination :page="pageFor(memberOffset)" :pages="pagesFor(members?.total)" @update:page="memberOffset = offsetFor($event, members?.total)" /></div>
      <div v-if="canManage" class="grid gap-2 p-3">
        <UFormField :label="t('chat.addMember')" name="recipientSearch">
          <UInput v-model="recipientQ" class="w-full" :placeholder="t('chat.recipientSearch')" :disabled="!hydrated || busy" />
        </UFormField>
        <ul v-if="candidates.length" class="max-h-40 divide-y divide-default overflow-y-auto rounded-control ring ring-default">
          <li v-for="person in candidates" :key="person.id">
            <UButton type="button" color="neutral" variant="ghost" class="w-full justify-start rounded-none px-3 py-2 text-start" :disabled="!hydrated || busy" :label="person.name" @click="add(person.id)" />
          </li>
        </ul>
      </div>
    </SharedRecordSection>
    <SharedRecordSection variant="list" :title="t('chat.attachments')">
      <SharedPageState :loading="attachmentsLoading || !hydrated" :error="attachmentsError" :empty="!attachments?.items.length" :empty-text="t('chat.noAttachments')" @retry="refetchAttachments()">
        <div v-for="attachment in attachments?.items" :key="attachment.id" class="p-3"><ChatAttachment :attachment="attachment" /></div>
      </SharedPageState>
      <div v-if="pagesFor(attachments?.total) > 1" class="p-3"><SharedPagination :page="pageFor(fileOffset)" :pages="pagesFor(attachments?.total)" @update:page="fileOffset = offsetFor($event, attachments?.total)" /></div>
    </SharedRecordSection>
    <div v-if="canLeave" class="grid gap-3">
      <div v-if="!leaving" class="flex justify-end">
        <UButton type="button" color="neutral" variant="outline" icon="i-lucide-log-out" :disabled="!hydrated || busy" :label="t('chat.leave')" @click="leaving = true" />
      </div>
      <SharedInlineConfirm v-else :title="t('chat.leaveConfirmTitle')" :confirm-label="t('chat.confirmLeave')" :pending="busy" @confirm="confirmLeave" @cancel="leaving = false" />
    </div>
  </section>
</template>
