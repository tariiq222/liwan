<script setup lang="ts">
import { useInboxAgents, useSetInboxAgentAvailability } from '@/composables/inbox/useInbox'
import { inboxAgentStatus } from '@/composables/inbox/inboxAgents'

// The signed-in agent's own "available / unavailable" switch in the inbox header. It is drawn only for a user who may
// reply and who is in the agents list. While unavailable the agent receives no automatic assignments; a shift can
// still keep an available agent out of distribution, which the label says.
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { me } = useMe()
const { can } = useAccess()
const canReply = computed(() => can('inbox.conversations.reply'))
const agents = useInboxAgents(canReply)
const { mutate: setAvailability, isPending } = useSetInboxAgentAvailability()

const self = computed(() => agents.data.value?.items.find(agent => agent.id === me.value?.id))
const status = computed(() => (self.value ? inboxAgentStatus(self.value) : null))

function change(available: boolean) {
  if (!self.value || !hydrated.value || isPending.value) return
  setAvailability({ userId: self.value.id, available }, {
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <div v-if="self && status" class="flex items-center gap-2" data-testid="inbox-availability">
    <USwitch :model-value="self.available" :disabled="!hydrated || isPending" :aria-label="t('inbox.availability.label')" data-testid="inbox-availability-switch" @update:model-value="change" />
    <span class="text-sm" :class="status === 'available' ? 'text-highlighted' : 'text-muted'" data-testid="inbox-availability-label">{{ t(`inbox.agentStatus.${status}`) }}</span>
  </div>
</template>
