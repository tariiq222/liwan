<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { CHAT_PAGE_SIZE, nextListOffset, parseChatListRoute, serializeChatListRoute } from '@/utils/chatState'

const { t } = useI18n()
const hydrated = useHydrated()
const route = useRoute()
const listQuery = computed(() => serializeChatListRoute(parseChatListRoute(route.query)))
const q = ref('')
const recipientOffset = ref(0)
const selected = ref<{ id: number; name: string }[]>([])
const groupName = ref('')
const { data } = useChatRecipients(q, recipientOffset)
const { mutateAsync: create, isPending } = useCreateConversation()
const recipients = computed(() => data.value?.items ?? [])
watch(q, () => { recipientOffset.value = 0 })

function toggle(person: { id: number; name: string }) {
  if (selected.value.some(item => item.id === person.id)) {
    selected.value = selected.value.filter(item => item.id !== person.id)
    return
  }
  selected.value = [...selected.value, person]
}

async function submit() {
  if (selected.value.length < 1) {
    toast.error(t('chat.needRecipient'))
    return
  }
  try {
    const conversation = await create({
      user_ids: selected.value.map(item => item.id),
      name: selected.value.length > 1 ? groupName.value.trim() || undefined : undefined,
    })
    await navigateTo({ path: `/chat/${conversation.id}`, query: listQuery.value })
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  }
}
</script>

<template>
  <div class="nasq-page-stack mx-auto w-full max-w-3xl">
    <SharedPageHeader :title="t('chat.newTitle')" :description="t('chat.newDescription')" :back-to="{ path: '/chat', query: listQuery }" />
    <form class="nasq-panel nasq-panel-body flex flex-col gap-4" @submit.prevent="submit">
      <Input v-model="q" :placeholder="t('chat.recipientSearch')" :disabled="!hydrated" />
      <ul class="max-h-64 overflow-y-auto rounded-lg border">
        <li v-for="person in recipients" :key="person.id">
          <button type="button" class="flex w-full items-center justify-between px-3 py-2 text-start hover:bg-muted" :disabled="!hydrated" @click="toggle(person)">
            <span>{{ person.name }}</span>
            <span v-if="selected.some(item => item.id === person.id)" class="text-xs text-primary">{{ t('chat.selected') }}</span>
          </button>
        </li>
      </ul>
      <div v-if="(data?.total ?? 0) > CHAT_PAGE_SIZE" class="flex justify-between">
        <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || recipientOffset === 0" @click="recipientOffset = nextListOffset(recipientOffset, data?.total ?? 0, -CHAT_PAGE_SIZE)">{{ t('chat.previousPage') }}</Button>
        <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || recipientOffset + CHAT_PAGE_SIZE >= (data?.total ?? 0)" @click="recipientOffset = nextListOffset(recipientOffset, data?.total ?? 0, CHAT_PAGE_SIZE)">{{ t('chat.nextPage') }}</Button>
      </div>
      <p class="text-sm text-muted-foreground">{{ selected.map(item => item.name).join(', ') }}</p>
      <div v-if="selected.length > 1" class="grid gap-2">
        <label class="text-sm" for="chat-group-name">{{ t('chat.groupName') }}</label>
        <Input id="chat-group-name" v-model="groupName" :placeholder="t('chat.groupNamePlaceholder')" :disabled="!hydrated" />
      </div>
      <Button type="submit" :disabled="!hydrated || isPending || selected.length < 1">{{ t('chat.create') }}</Button>
    </form>
  </div>
</template>
