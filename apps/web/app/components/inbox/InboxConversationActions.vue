<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import type { InboxConversationDetail, InboxConversationPatch } from '@liwan/contracts'
import { useInboxConversationSave } from '@/composables/inbox/useInboxConversationSave'
import { PRIORITIES } from '@/composables/inbox/inboxPresentation'

// The frequent conversation actions in the thread header: assign to me, resolve or reopen, and the priority menu. A control the
// user may not use is not drawn (the contact panel still shows the read-only value). Below 768px the two buttons are icon-only.
const props = defineProps<{ conversation: InboxConversationDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { me } = useMe()
const { save, patching } = useInboxConversationSave(() => props.conversation)
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const locked = computed(() => !hydrated.value || patching.value)

const canAssignToMe = computed(() => props.conversation.can_assign && !!me.value && props.conversation.assignee?.id !== me.value.id)
const resolved = computed(() => props.conversation.state === 'resolved' || props.conversation.state === 'closed')
const stateAction = computed(() => ({
  state: (resolved.value ? 'open' : 'resolved') as InboxConversationPatch['state'],
  label: t(resolved.value ? 'inbox.actions.reopen' : 'inbox.actions.resolve'),
  icon: resolved.value ? 'i-lucide-rotate-ccw' : 'i-lucide-check-check',
}))
const assignLabel = computed(() => t('inbox.panel.assignToMe'))
const moreItems = computed(() => {
  const priorities = props.conversation.can_reply
    ? PRIORITIES.map(value => ({
        label: t(`inbox.priorities.${value}`),
        type: 'checkbox' as const,
        checked: props.conversation.priority === value,
        onSelect: () => { if (value !== props.conversation.priority) save({ priority: value }) },
      }))
    : []
  const unassign = props.conversation.can_assign && props.conversation.assignee
    ? [{ label: t('inbox.panel.unassign'), icon: 'i-lucide-user-x', onSelect: () => save({ assignee_id: null }) }]
    : []
  return [priorities, unassign].filter(group => group.length)
})
const showMore = computed(() => moreItems.value.length > 0)

function assignToMe() {
  if (me.value) save({ assignee_id: me.value.id })
}
function changeState() {
  save({ state: stateAction.value.state })
}
</script>

<template>
  <div role="toolbar" :aria-label="t('inbox.actions.label')" class="flex items-center gap-1" data-testid="inbox-conversation-actions">
    <UTooltip v-if="canAssignToMe" :text="assignLabel" :disabled="isDesktop">
      <UButton
        color="neutral" variant="soft" icon="i-lucide-user-check" class="liwan-touch-target max-md:min-w-11 max-md:justify-center"
        :label="isDesktop ? assignLabel : undefined" :aria-label="assignLabel" :disabled="locked"
        data-testid="inbox-assign-me" @click="assignToMe"
      />
    </UTooltip>
    <UTooltip v-if="conversation.can_reply" :text="stateAction.label" :disabled="isDesktop">
      <UButton
        color="neutral" variant="soft" :icon="stateAction.icon" class="liwan-touch-target max-md:min-w-11 max-md:justify-center"
        :label="isDesktop ? stateAction.label : undefined" :aria-label="stateAction.label" :disabled="locked"
        data-testid="inbox-change-state" @click="changeState"
      />
    </UTooltip>
    <UDropdownMenu v-if="showMore" :items="moreItems" :content="{ align: 'end' }">
      <UTooltip :text="t('inbox.actions.more')">
        <UButton
          color="neutral" variant="ghost" square icon="i-lucide-ellipsis" class="liwan-touch-target max-md:min-w-11"
          :aria-label="t('inbox.actions.more')" :disabled="locked" data-testid="inbox-more-actions"
        />
      </UTooltip>
    </UDropdownMenu>
  </div>
</template>
