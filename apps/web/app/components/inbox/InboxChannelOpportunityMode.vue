<script setup lang="ts">
import type { ConversationOpportunityMode } from '@liwan/contracts'
import { useChannelOpportunityMode, useChannelOpportunityModeAccess, usePatchChannelOpportunityMode } from '@/composables/useInboxChannelOpportunityMode'

// The channel's CRM setting: whether the first message of a new conversation opens a sales opportunity by itself. It is
// shown only where the tenant has CRM and the user manages both the channel and the CRM settings; a change saves at once.
const props = defineProps<{ channelId: number }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const available = useChannelOpportunityModeAccess()
const query = useChannelOpportunityMode(() => props.channelId, available)
const { mutate: patch, isPending } = usePatchChannelOpportunityMode(() => props.channelId)
const items = computed(() => (['manual', 'auto_first_message'] as const).map(value => ({
  value,
  label: t(`inbox.opportunity.mode.${value}`),
  description: t(value === 'manual' ? 'inbox.opportunity.mode.manualHint' : 'inbox.opportunity.mode.autoHint'),
})))
const off = computed(() => !hydrated.value || isPending.value)

function change(mode: ConversationOpportunityMode) {
  if (off.value || mode === query.data.value?.opportunity_mode) return
  patch(mode, {
    onSuccess: () => toast.add({ title: t('inbox.opportunity.mode.saved'), color: 'success' }),
    onError: error => toast.add({ title: error instanceof Error ? error.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedRecordSection v-if="available" variant="panel" :title="t('inbox.opportunity.mode.title')" :description="t('inbox.opportunity.mode.hint')" data-testid="inbox-channel-opportunity-mode">
    <SharedLoadingSkeleton v-if="query.isPending.value" />
    <SharedPageState v-else-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <URadioGroup
      v-else-if="query.data.value"
      :model-value="query.data.value.opportunity_mode"
      :items="items"
      :legend="t('inbox.opportunity.mode.label')"
      variant="card"
      :disabled="off"
      data-testid="inbox-channel-opportunity-mode-group"
      @update:model-value="change($event as ConversationOpportunityMode)"
    />
  </SharedRecordSection>
</template>
