<script setup lang="ts">
import InboxAgentShiftsForm from '@/components/inbox/InboxAgentShiftsForm.vue'
import { INBOX_AGENT_STATUS_TONE, inboxAgentStatus } from '@/composables/inbox/inboxAgents'
import { useInboxAgents, useSetInboxAgentAvailability } from '@/composables/inbox/useInbox'
import { useInboxSettings } from '@/composables/inbox/useInboxSettings'

// The inbox agents with their availability. Automatic distribution skips an agent who is unavailable, or outside
// their shift when shifts are on. A holder of the assign capability switches anyone; an agent switches only themselves.
// The weekly shift of each agent is edited here and only when the company turned shifts on.
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { me } = useMe()
const { can } = useAccess()
const { data, isLoading, error, refetch } = useInboxAgents()
const settings = useInboxSettings()
const { mutate: setAvailability, isPending } = useSetInboxAgentAvailability()
const shiftsOn = computed(() => settings.data.value?.agent_shifts_enabled === true)
const openShifts = ref<number | null>(null)
const items = computed(() => data.value?.items ?? [])
const canAssign = computed(() => can('inbox.conversations.assign'))
const canToggle = (id: number) => canAssign.value || (can('inbox.conversations.reply') && id === me.value?.id)

function toggle(userId: number, available: boolean) {
  if (!hydrated.value || isPending.value) return
  setAvailability({ userId, available }, {
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedRecordSection id="agents" variant="panel" class="liwan-settings-anchor" :title="t('inbox.settings.agents.title')" :description="t('inbox.settings.agents.hint')">
    <SharedLoadingSkeleton v-if="isLoading" />
    <SharedPageState v-else-if="error" :error="error" @retry="refetch()" />
    <p v-else-if="!items.length" class="text-sm text-muted">{{ t('inbox.settings.agents.empty') }}</p>
    <ul v-else class="flex flex-col divide-y divide-default" data-testid="inbox-agents">
      <li v-for="agent in items" :key="agent.id" class="flex flex-col gap-3 py-3" :data-testid="`inbox-agent-${agent.id}`">
        <div class="flex flex-wrap items-center gap-3">
          <span class="min-w-0 flex-1 truncate font-medium text-highlighted">{{ agent.name }}</span>
          <SharedStatusBadge :tone="INBOX_AGENT_STATUS_TONE[inboxAgentStatus(agent)]" :label="t(`inbox.agentStatus.${inboxAgentStatus(agent)}`)" />
          <USwitch :model-value="agent.available" :disabled="!hydrated || isPending || !canToggle(agent.id)" :aria-label="t('inbox.settings.agents.available', { name: agent.name })" @update:model-value="toggle(agent.id, $event)" />
          <UButton v-if="shiftsOn" type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-clock" :aria-expanded="openShifts === agent.id" :label="t('inbox.settings.agents.shift')" :data-testid="`inbox-agent-shift-${agent.id}`" @click="openShifts = openShifts === agent.id ? null : agent.id" />
        </div>
        <InboxAgentShiftsForm v-if="shiftsOn && openShifts === agent.id" :user-id="agent.id" @close="openShifts = null" />
      </li>
    </ul>
  </SharedRecordSection>
</template>
