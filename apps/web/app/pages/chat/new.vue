<script setup lang="ts">
import { Check } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { CHAT_PAGE_SIZE, initialsFor, nextListOffset, parseChatListRoute, serializeChatListRoute } from '@/utils/chatState'

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
function snapshot() {
  return JSON.stringify([selected.value.map(item => item.id), groupName.value])
}
const baseline = ref(snapshot())
const dirty = computed(() => snapshot() !== baseline.value)

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
    baseline.value = snapshot()
    await nextTick()
    await navigateTo({ path: `/chat/${conversation.id}`, query: listQuery.value })
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  }
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('chat.newTitle')" :description="t('chat.newDescription')" :back-to="{ path: '/chat', query: listQuery }" />
    <form class="nasq-form nasq-panel nasq-panel-body flex flex-col gap-4" @submit.prevent="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedFormSection :title="t('chat.recipients')" class="grid gap-4">
        <Label for="chat-recipient-search">{{ t('chat.recipientSearch') }}</Label>
        <Input id="chat-recipient-search" v-model="q" :placeholder="t('chat.recipientSearch')" :disabled="!hydrated" />
        <ul class="max-h-64 overflow-y-auto rounded-lg border">
          <li v-for="person in recipients" :key="person.id">
            <button
              type="button"
              class="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-pressed="selected.some(item => item.id === person.id)"
              :disabled="!hydrated"
              @click="toggle(person)"
            >
              <span class="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{{ initialsFor(person.name) }}</span>
              <span class="min-w-0 flex-1 truncate">{{ person.name }}</span>
              <Check v-if="selected.some(item => item.id === person.id)" class="size-4 text-primary" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <nav v-if="(data?.total ?? 0) > CHAT_PAGE_SIZE" class="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || recipientOffset === 0" @click="recipientOffset = nextListOffset(recipientOffset, data?.total ?? 0, -CHAT_PAGE_SIZE)">{{ t('chat.previousPage') }}</Button>
          <Button type="button" size="sm" variant="ghost" :disabled="!hydrated || recipientOffset + CHAT_PAGE_SIZE >= (data?.total ?? 0)" @click="recipientOffset = nextListOffset(recipientOffset, data?.total ?? 0, CHAT_PAGE_SIZE)">{{ t('chat.nextPage') }}</Button>
        </nav>
        <p class="text-sm text-muted-foreground"><span class="font-medium text-foreground">{{ t('chat.selected') }}:</span> {{ selected.map(item => item.name).join(', ') || '—' }}</p>
      </SharedFormSection>
      <SharedFormSection v-if="selected.length > 1" :title="t('chat.groupName')" class="grid gap-2">
        <Label for="chat-group-name">{{ t('chat.groupName') }}</Label>
        <Input id="chat-group-name" v-model="groupName" :placeholder="t('chat.groupNamePlaceholder')" :disabled="!hydrated" />
      </SharedFormSection>
      <div class="flex justify-end gap-2">
        <NuxtLink :to="{ path: '/chat', query: listQuery }"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
        <Button type="submit" :disabled="!hydrated || isPending || selected.length < 1">{{ t('chat.create') }}</Button>
      </div>
    </form>
  </SharedPageContainer>
</template>
