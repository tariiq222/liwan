<script setup lang="ts">
import type { InboxConversationDetail, InboxConversationPatch } from '@webvue/contracts'
import { useInboxAgents, usePatchInboxContact, usePatchInboxConversation, useInboxTags } from '@/composables/inbox/useInbox'
import { useInboxDepartments } from '@/composables/inbox/useInboxSettings'
import { CONVERSATION_STATES, PRIORITIES } from '@/composables/inbox/inboxPresentation'

// The contact and the conversation controls. Assignment and department need the assign capability (`can_assign`), the
// rest need the reply capability (`can_reply`); a control the user may not use is shown disabled with its current value.
const props = defineProps<{ conversation: InboxConversationDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { me } = useMe()
const id = computed(() => props.conversation.id)
const { mutate: patch, isPending: patching } = usePatchInboxConversation(id)
const { mutate: patchContact, isPending: savingContact } = usePatchInboxContact(() => props.conversation.contact.id)
const departments = useInboxDepartments()
const tags = useInboxTags()
const agents = useInboxAgents(() => props.conversation.can_assign)
const lockedReply = computed(() => !hydrated.value || patching.value || !props.conversation.can_reply)
const lockedAssign = computed(() => !hydrated.value || patching.value || !props.conversation.can_assign)

const stateItems = computed(() => CONVERSATION_STATES.map(value => ({ value, label: t(`inbox.states.${value}`) })))
const priorityItems = computed(() => PRIORITIES.map(value => ({ value, label: t(`inbox.priorities.${value}`) })))
const NONE = 'none'
const departmentItems = computed(() => [
  { value: NONE, label: t('inbox.panel.noDepartment') },
  ...(departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name })),
  // The current department stays selectable when the list is not available to this user.
  ...(props.conversation.department && !(departments.data.value?.items ?? []).some(item => item.id === props.conversation.department!.id)
    ? [{ value: String(props.conversation.department.id), label: props.conversation.department.name }]
    : []),
])
const tagItems = computed(() => tags.data.value?.items ?? props.conversation.tags)
const tagIds = computed(() => props.conversation.tags.map(tag => tag.id))
const assigneeIds = computed(() => props.conversation.assignee ? [props.conversation.assignee.id] : [])

function save(body: InboxConversationPatch) {
  patch(body, { onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }) })
}
function assign(value: number | number[] | null) {
  const next = Array.isArray(value) ? (value[0] ?? null) : value
  if (next !== (props.conversation.assignee?.id ?? null)) save({ assignee_id: next })
}

// The contact's name and email are edited together and saved once.
const name = ref(props.conversation.contact.name)
const email = ref(props.conversation.contact.email ?? '')
watch(() => props.conversation.contact, (contact) => {
  name.value = contact.name
  email.value = contact.email ?? ''
})
const contactDirty = computed(() => name.value.trim() !== props.conversation.contact.name || email.value.trim() !== (props.conversation.contact.email ?? ''))
function saveContact() {
  if (!contactDirty.value || !name.value.trim()) return
  patchContact(
    { name: name.value.trim(), email: email.value.trim() || null },
    { onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }) },
  )
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4" data-testid="inbox-contact-panel">
    <SharedRecordSection variant="panel" :title="t('inbox.panel.contact')">
      <form class="flex flex-col gap-3" @submit.prevent="saveContact">
        <UFormField :label="t('inbox.panel.name')">
          <UInput v-model="name" class="w-full" :disabled="lockedReply || savingContact" />
        </UFormField>
        <dl class="divide-y divide-default">
          <SharedPropertyRow :label="t('inbox.panel.phone')"><bdi v-if="props.conversation.contact.phone" dir="ltr" class="whitespace-nowrap">{{ props.conversation.contact.phone }}</bdi></SharedPropertyRow>
          <SharedPropertyRow :label="t('inbox.panel.channel')" :value="props.conversation.channel.name" />
        </dl>
        <UFormField :label="t('inbox.panel.email')">
          <UInput v-model="email" type="email" class="w-full" dir="ltr" :disabled="lockedReply || savingContact" />
        </UFormField>
        <UButton v-if="props.conversation.can_reply" type="submit" color="neutral" variant="outline" class="self-start" :disabled="!hydrated || !contactDirty || !name.trim()" :loading="savingContact" :label="t('inbox.panel.saveContact')" />
      </form>
    </SharedRecordSection>

    <SharedRecordSection variant="panel" :title="t('inbox.panel.conversation')">
      <div class="flex flex-col gap-3">
        <UFormField :label="t('inbox.panel.assignee')" :description="props.conversation.can_assign ? undefined : t('inbox.panel.assignDenied')">
          <SharedPersonPicker
            :model-value="props.conversation.assignee?.id ?? null"
            value-key="user_id"
            :known="assigneeIds.length ? [props.conversation.assignee!] : []"
            :options="agents.data.value?.items ?? []"
            :placeholder="t('inbox.unassigned')"
            :disabled="lockedAssign"
            :aria-label="t('inbox.panel.assignee')"
            @update:model-value="assign"
          />
          <div v-if="props.conversation.can_assign" class="mt-1.5 flex flex-wrap gap-2">
            <UButton
              v-if="me && props.conversation.assignee?.id !== me.id"
              type="button" size="xs" color="neutral" variant="outline"
              :disabled="lockedAssign" :label="t('inbox.panel.assignToMe')"
              @click="save({ assignee_id: me.id })"
            />
            <UButton
              v-if="props.conversation.assignee"
              type="button" size="xs" color="neutral" variant="ghost"
              :disabled="lockedAssign" :label="t('inbox.panel.unassign')"
              @click="save({ assignee_id: null })"
            />
          </div>
        </UFormField>
        <UFormField :label="t('inbox.panel.department')">
          <USelect
            :model-value="props.conversation.department ? String(props.conversation.department.id) : NONE"
            :items="departmentItems"
            class="w-full"
            :disabled="lockedAssign"
            @update:model-value="save({ department_id: $event === NONE ? null : Number($event) })"
          />
        </UFormField>
        <UFormField :label="t('inbox.panel.state')">
          <USelect :model-value="props.conversation.state" :items="stateItems" class="w-full" :disabled="lockedReply" @update:model-value="save({ state: $event as InboxConversationPatch['state'] })" />
        </UFormField>
        <UFormField :label="t('inbox.panel.priority')">
          <USelect :model-value="props.conversation.priority" :items="priorityItems" class="w-full" :disabled="lockedReply" @update:model-value="save({ priority: $event as InboxConversationPatch['priority'] })" />
        </UFormField>
        <UFormField :label="t('inbox.panel.tags')">
          <USelectMenu
            :model-value="tagIds"
            multiple
            value-key="id"
            label-key="name"
            :items="tagItems"
            class="w-full"
            :placeholder="t('inbox.panel.noTags')"
            :disabled="lockedReply"
            @update:model-value="save({ tag_ids: $event as number[] })"
          />
        </UFormField>
      </div>
    </SharedRecordSection>
  </div>
</template>
