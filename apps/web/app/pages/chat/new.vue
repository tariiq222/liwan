<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { CHAT_PAGE_SIZE, initialsFor, nextListOffset, parseChatListRoute, serializeChatListRoute } from '@/utils/chatState'

const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const route = useRoute()
const listQuery = computed(() => serializeChatListRoute(parseChatListRoute(route.query)))
const wantGroup = computed(() => route.query.kind === 'group')
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
  if (wantGroup.value && selected.value.length < 2) {
    toast.add({ title: t('chat.needRecipient'), color: 'error' })
    return
  }
  if (selected.value.length < 1 && !groupName.value.trim()) {
    toast.add({ title: t('chat.needRecipient'), color: 'error' })
    return
  }
  try {
    const conversation = await create(
      selected.value.length
        ? {
            user_ids: selected.value.map(item => item.id),
            name: selected.value.length > 1 ? groupName.value.trim() || undefined : undefined,
          }
        : { type: 'channel', name: groupName.value.trim() },
    )
    baseline.value = snapshot()
    await nextTick()
    await navigateTo({ path: `/chat/${conversation.id}`, query: listQuery.value })
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <SharedCreatePanel :title="t(wantGroup ? 'chat.newGroupTitle' : 'chat.newTitle')" :description="t(wantGroup ? 'chat.newGroupDescription' : 'chat.newDescription')" :back-to="{ path: '/chat', query: listQuery }">
    <form class="space-y-6" @submit.prevent="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedFormSection :title="t('chat.recipients')" class="space-y-4">
        <UFormField :label="t('chat.recipientSearch')" name="recipientSearch">
          <UInput id="chat-recipient-search" v-model="q" class="w-full" :placeholder="t('chat.recipientSearch')" :disabled="!hydrated" />
        </UFormField>
        <ul class="max-h-64 overflow-y-auto rounded-lg border border-default">
          <li v-for="person in recipients" :key="person.id">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              class="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              :aria-pressed="selected.some(item => item.id === person.id)"
              :disabled="!hydrated"
              @click="toggle(person)"
            >
              <span class="grid size-9 shrink-0 place-items-center rounded-full bg-elevated text-xs font-semibold">{{ initialsFor(person.name) }}</span>
              <span class="min-w-0 flex-1 truncate">{{ person.name }}</span>
              <UIcon v-if="selected.some(item => item.id === person.id)" name="i-lucide-check" class="size-4 text-brand-link" aria-hidden="true" />
            </UButton>
          </li>
        </ul>
        <SharedPagination :page="Math.floor(recipientOffset / CHAT_PAGE_SIZE) + 1" :pages="Math.max(1, Math.ceil((data?.total ?? 0) / CHAT_PAGE_SIZE))" @update:page="recipientOffset = nextListOffset(0, data?.total ?? 0, ($event - 1) * CHAT_PAGE_SIZE)" />
        <p class="text-sm text-muted"><span class="font-medium text-highlighted">{{ t('chat.selected') }}:</span> {{ selected.map(item => item.name).join(', ') || '—' }}</p>
      </SharedFormSection>
      <SharedFormSection v-if="wantGroup || selected.length !== 1" :title="t('chat.groupName')" class="space-y-2">
        <UFormField :label="selected.length ? t('chat.groupName') : t('chat.channel')" name="groupName">
          <UInput id="chat-group-name" v-model="groupName" class="w-full" :placeholder="t('chat.groupNamePlaceholder')" :disabled="!hydrated" />
        </UFormField>
      </SharedFormSection>
      <div class="flex justify-end gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="{ path: '/chat', query: listQuery }" :label="t('app.cancel')" />
        <UButton type="submit" :disabled="!hydrated || isPending || (wantGroup ? selected.length < 2 : selected.length < 1 && !groupName.trim())" :label="t('chat.create')" />
      </div>
    </form>
  </SharedCreatePanel>
</template>
