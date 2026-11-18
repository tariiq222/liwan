<script setup lang="ts">
import InboxAgentShiftsForm from '@/components/inbox/InboxAgentShiftsForm.vue'
import { INBOX_AGENT_STATUS_TONE, inboxAgentStatus } from '@/composables/inbox/inboxAgents'
import { useInboxAgents, useSetInboxAgentAvailability } from '@/composables/inbox/useInbox'
import { useInboxSettings } from '@/composables/inbox/useInboxSettings'

// The inbox agents with their availability. Automatic distribution skips an agent who is unavailable, or outside
// their shift when shifts are on. A holder of the assign capability switches anyone; an agent switches only themselves.
// The weekly shift of each agent is edited here, by a holder of the settings capability, and only when the company turned
// shifts on. A holder of the assign capability alone sees the list and the switches, not the settings.
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { me } = useMe()
const { can } = useAccess()
const { data, isLoading, error, refetch } = useInboxAgents()
const canManage = computed(() => can('inbox.settings.manage'))
const settings = useInboxSettings(canManage)
const { mutate: setAvailability, isPending } = useSetInboxAgentAvailability()
const shiftsOn = computed(() => canManage.value && settings.data.value?.agent_shifts_enabled === true)
const openShifts = ref<number | null>(null)
// Opening another agent's shift or closing the open one drops its form; with an unsaved draft the section asks first.
const shiftsDirty = ref(false)
const pendingShifts = ref<{ target: number | null } | null>(null)
const items = computed(() => data.value?.items ?? [])
const canAssign = computed(() => can('inbox.conversations.assign'))
const canToggle = (id: number) => canAssign.value || (can('inbox.conversations.reply') && id === me.value?.id)

function requestShifts(target: number | null) {
  if (target === openShifts.value) target = null
  if (openShifts.value !== null && shiftsDirty.value) pendingShifts.value = { target }
  else openShifts.value = target
}
function discardShifts() {
  if (!pendingShifts.value) return
  openShifts.value = pendingShifts.value.target
  pendingShifts.value = null
}

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
          <UButton v-if="shiftsOn" type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-clock" :aria-expanded="openShifts === agent.id" :label="t('inbox.settings.agents.shift')" :data-testid="`inbox-agent-shift-${agent.id}`" @click="requestShifts(agent.id)" />
        </div>
        <InboxAgentShiftsForm v-if="shiftsOn && openShifts === agent.id" :user-id="agent.id" @dirty="shiftsDirty = $event" @close="requestShifts(null)" />
        <SharedInlineConfirm
          v-if="pendingShifts && openShifts === agent.id"
          :title="t('inbox.settings.agents.discardTitle', { name: agent.name })"
          :description="t('inbox.settings.agents.discardDescription')"
          :confirm-label="t('inbox.settings.agents.discard')"
          @confirm="discardShifts"
          @cancel="pendingShifts = null"
        />
      </li>
    </ul>
  </SharedRecordSection>
</template>
