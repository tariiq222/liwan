<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { avatarProps } from '@liwan/ui/app/utils/avatarTone'
import { parseChatListRoute, serializeChatListRoute } from '@/utils/chatState'

const { t } = useI18n()
const hydrated = useHydrated()
const route = useRoute()
const listQuery = computed(() => serializeChatListRoute(parseChatListRoute(route.query)))
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
usePageHeader(() => t(copy.value.title))
useEscapeBack(() => backTo.value)
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
  <SharedConversationLayout :has-selection="true" class="liwan-chat-create-layout" data-testid="chat-create-layout">
    <template #header>
      <header class="liwan-chat-thread-header">
        <UButton color="neutral" variant="ghost" square icon="i-lucide-arrow-left" :to="backTo" :aria-label="t('app.back')" :ui="{ leadingIcon: 'rtl:rotate-180' }" />
        <div class="min-w-0 flex-1">
          <h1 class="text-lg font-semibold text-highlighted">{{ t(copy.title) }}</h1>
          <p class="text-sm text-muted">{{ t(copy.description) }}</p>
        </div>
      </header>
    </template>
    <template #thread>
      <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
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
    </template>
    <template #composer>
      <div class="border-t border-default p-4">
        <div class="mx-auto w-full max-w-xl">
          <SharedFormActions>
            <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
            <UButton type="submit" form="chat-create-form" :disabled="!hydrated || isPending" :loading="isPending" :label="t(copy.submit)" />
          </SharedFormActions>
        </div>
      </div>
    </template>
  </SharedConversationLayout>
</template>
