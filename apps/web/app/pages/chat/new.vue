<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { avatarProps } from '@webvue/ui/app/utils/avatarTone'
import { parseChatListRoute, serializeChatListRoute } from '@/utils/chatState'

const { t } = useI18n()
const hydrated = useHydrated()
const route = useRoute()
const listQuery = computed(() => serializeChatListRoute(parseChatListRoute(route.query)))
const router = useRouter()
const sourcePaths = useRecordListPaths(['/chat'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const wantGroup = computed(() => route.query.kind === 'group')
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

function setSelected(people: { id: number; name: string }[]) {
  selected.value = people
}

function removePerson(id: number) {
  selected.value = selected.value.filter(item => item.id !== id)
}

async function submit() {
  if (!hydrated.value || submitting || isPending.value) return
  submitError.value = ''
  if (wantGroup.value && selected.value.length < 2) {
    submitError.value = t('chat.needRecipient')
    await nextTick()
    document.getElementById('chat-recipient-search')?.focus()
    return
  }
  if (selected.value.length < 1 && !groupName.value.trim()) {
    submitError.value = t('chat.needRecipient')
    await nextTick()
    document.getElementById('chat-recipient-search')?.focus()
    return
  }
  submitting = true
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
    await navigateTo({ path: `/chat/${conversation.id}`, query: { ...listQuery.value, returnTo: router.resolve(backTo.value).fullPath } }, { replace: true })
  } catch (error) {
    submitError.value = error instanceof ApiError ? error.message : t('errors.generic')
  } finally { submitting = false }
}
</script>

<template>
  <SharedCreatePanel :title="t(wantGroup ? 'chat.newGroupTitle' : 'chat.newTitle')" :description="t(wantGroup ? 'chat.newGroupDescription' : 'chat.newDescription')" :back-to="backTo">
    <form class="space-y-6" @submit.prevent="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedFormSection :title="t('chat.recipients')" class="space-y-4">
        <UFormField :label="t('chat.recipientSearch')" name="recipientSearch">
          <SharedPersonPicker
            id="chat-recipient-search"
            :model-value="selectedIds"
            multiple
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
      <SharedFormSection v-if="wantGroup || selected.length !== 1" :title="t('chat.groupName')" class="space-y-2">
        <UFormField :label="selected.length ? t('chat.groupName') : t('chat.channel')" name="groupName">
          <UInput id="chat-group-name" v-model="groupName" class="w-full" :placeholder="t('chat.groupNamePlaceholder')" :disabled="!hydrated" />
        </UFormField>
      </SharedFormSection>
      <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />
      <SharedFormActions class="flex justify-end gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" :disabled="!hydrated || isPending" :loading="isPending" :label="t('chat.create')" />
      </SharedFormActions>
    </form>
  </SharedCreatePanel>
</template>
