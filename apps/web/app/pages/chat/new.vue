<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import ConversationList from '@/components/chat/ConversationList.vue'
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { avatarProps } from '@liwan/ui/app/utils/avatarTone'
import { parseChatListRoute, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'

const { t } = useI18n()
const hydrated = useHydrated()
const route = useRoute()
const routeState = computed(() => parseChatListRoute(route.query))
const listQuery = computed(() => serializeChatListRoute(routeState.value))
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const router = useRouter()
const sourcePaths = useRecordListPaths(['/chat'])
const backTo = computed(() => {
  const { kind: _kind, ...query } = route.query
  return owningListBack(query, sourcePaths.value, route.hash)
})
const kind = computed(() => route.query.kind === 'group' || route.query.kind === 'channel' ? route.query.kind : 'direct')
const copy = computed(() => ({
  direct: { title: 'chat.newTitle', description: 'chat.newDescription', submit: 'chat.create', error: 'chat.needDirectRecipient' },
  group: { title: 'chat.newGroupTitle', description: 'chat.newGroupDescription', submit: 'chat.createGroup', error: 'chat.needGroupRecipients' },
  channel: { title: 'chat.newChannelTitle', description: 'chat.newChannelDescription', submit: 'chat.createChannel', error: 'chat.needChannelName' },
})[kind.value])
// The list beside the form keeps its filters in the URL query next to the creation kind.
function updateList(next: ChatListRoute) {
  void router.replace({ path: route.path, query: { ...route.query, ...serializeChatListRoute(next) } })
}
const selected = ref<{ id: number; name: string }[]>([])
const groupName = ref('')
const submitError = ref('')
let submitting = false
const { mutateAsync: create, isPending } = useCreateConversation()
const selectedIds = computed(() => selected.value.map(item => item.id))
function snapshot() {
  return JSON.stringify([selected.value.map(item => item.id), groupName.value])
}
const baseline = ref(snapshot())
const dirty = computed(() => snapshot() !== baseline.value)
watch(kind, () => {
  selected.value = []
  groupName.value = ''
  submitError.value = ''
  baseline.value = snapshot()
})

function setSelected(people: { id: number; name: string }[]) {
  selected.value = people
}

function removePerson(id: number) {
  selected.value = selected.value.filter(item => item.id !== id)
}

async function submit() {
  if (!hydrated.value || submitting || isPending.value) return
  submitError.value = ''
  const type = kind.value
  const invalid = type === 'channel' ? !groupName.value.trim() : type === 'group' ? selected.value.length < 2 : selected.value.length !== 1
  if (invalid) {
    submitError.value = t(copy.value.error)
    await nextTick()
    document.getElementById(type === 'channel' ? 'chat-group-name' : 'chat-recipient-search')?.focus()
    return
  }
  submitting = true
  try {
    const conversation = await create(
      type !== 'channel'
        ? {
            type,
            user_ids: selected.value.map(item => item.id),
            ...(type === 'group' ? { name: groupName.value.trim() || undefined } : {}),
          }
        : { type: 'channel', name: groupName.value.trim() },
    )
    baseline.value = snapshot()
    await nextTick()
    await navigateTo({ path: `/chat/${conversation.id}`, query: { ...listQuery.value, returnTo: router.resolve(backTo.value).fullPath } }, { replace: true })
  } catch (error) {
    submitError.value = error instanceof ApiError ? error.message : t('errors.generic')
  } finally { submitting = false }
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t(copy.title)" :back-to="backTo" :back-label="t('chat.title')" />
    <div class="grid h-[max(540px,calc(100svh-340px))] min-w-0 overflow-hidden rounded-surface border-[1.5px] border-default bg-default" :class="isDesktop ? 'grid-cols-[360px_minmax(0,1fr)]' : 'grid-cols-1'" data-template="conversation-layout" data-testid="chat-create-layout">
      <div v-if="isDesktop" data-template="conversation-list" class="flex min-h-0 min-w-0 flex-col border-e-[1.5px] border-default">
        <ConversationList class="min-h-0 flex-1" :route-state="routeState" @update:route-state="updateList" />
      </div>
      <section data-template="conversation-thread" class="flex min-h-0 min-w-0 flex-col">
        <header data-template="conversation-header" class="flex shrink-0 flex-wrap items-center gap-3 border-b-[1.5px] border-default bg-default px-[18px] py-3">
          <UButton class="md:hidden" color="neutral" variant="ghost" square icon="i-lucide-arrow-left" :to="backTo" :aria-label="t('app.back')" :ui="{ leadingIcon: 'rtl:rotate-180' }" />
          <div class="min-w-0 flex-1">
            <h2 class="text-[17px]/[1.3] font-semibold text-highlighted">{{ t(copy.title) }}</h2>
            <p class="text-sm text-muted">{{ t(copy.description) }}</p>
          </div>
        </header>
        <div data-template="conversation-messages" class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <form id="chat-create-form" data-testid="chat-create-form" :aria-label="t(copy.title)" class="mx-auto w-full max-w-xl space-y-6" @submit.prevent="submit">
            <SharedUnsavedChanges :dirty="dirty" guard-route-updates :ignore-query-keys="['q', 'filter', 'offset']" />
            <SharedFormSection v-if="kind !== 'channel'" :title="t('chat.recipients')" class="space-y-4">
              <UFormField :label="t('chat.recipientSearch')" name="recipientSearch">
                <SharedPersonPicker
                  id="chat-recipient-search"
                  :model-value="kind === 'group' ? selectedIds : selectedIds[0] ?? null"
                  :multiple="kind === 'group'"
                  value-key="user_id"
                  :known="selected"
                  :placeholder="t('chat.recipientSearch')"
                  @resolve="setSelected"
                />
              </UFormField>
              <ul v-if="selected.length" class="flex flex-wrap gap-2" :aria-label="t('chat.selected')">
                <li v-for="person in selected" :key="person.id">
                  <UBadge color="neutral" variant="subtle" size="lg" class="gap-1">
                    <UAvatar v-bind="avatarProps(person.name, person.id)" size="2xs" />
                    <span>{{ person.name }}</span>
                    <UButton type="button" color="neutral" variant="link" size="xs" square icon="i-lucide-x" :aria-label="t('chat.removeRecipient', { name: person.name })" :disabled="!hydrated" @click="removePerson(person.id)" />
                  </UBadge>
                </li>
              </ul>
            </SharedFormSection>
            <SharedFormSection v-if="kind !== 'direct'" :title="t(kind === 'channel' ? 'chat.channelName' : 'chat.groupName')" class="space-y-2">
              <UFormField :label="t(kind === 'channel' ? 'chat.channelName' : 'chat.groupName')" name="groupName" :required="kind === 'channel'">
                <UInput id="chat-group-name" v-model="groupName" class="w-full" :placeholder="t(kind === 'channel' ? 'chat.channelNamePlaceholder' : 'chat.groupNamePlaceholder')" :disabled="!hydrated" />
              </UFormField>
            </SharedFormSection>
            <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />
          </form>
        </div>
        <div data-template="conversation-composer" class="shrink-0 border-t-[1.5px] border-default p-4">
          <div class="mx-auto w-full max-w-xl">
            <SharedFormActions class="justify-end">
              <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
              <UButton type="submit" form="chat-create-form" :disabled="!hydrated || isPending" :loading="isPending" :label="t(copy.submit)" />
            </SharedFormActions>
          </div>
        </div>
      </section>
    </div>
  </SharedPageContainer>
</template>
