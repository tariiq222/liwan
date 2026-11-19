import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { InboxChannelCrmSettingsSchema, type ConversationOpportunityMode } from '@liwan/contracts'
import { hasFeature } from '../modules/registry'

// Whether a new conversation of a channel opens a CRM opportunity by itself (the inbox bridge to CRM). The server answers
// only a user who manages both the channel and the CRM settings, and only while the tenant has CRM.

const modeKey = (channelId: number) => ['inbox', 'channel-opportunity-mode', channelId] as const

export function useChannelOpportunityModeAccess() {
  const { can } = useAccess()
  const { me } = useMe()
  return computed(() => hasFeature(me.value, 'crm.enabled') && can('inbox.channels.manage') && can('crm.settings.manage'))
}

export function useChannelOpportunityMode(channelId: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => modeKey(toValue(channelId))),
    enabled: computed(() => toValue(channelId) > 0 && toValue(enabled)),
    retry: false,
    queryFn: ({ signal }) => $api(`/api/v1/inbox/channels/${toValue(channelId)}/crm-settings`, { signal, schema: InboxChannelCrmSettingsSchema }),
  })
}

export function usePatchChannelOpportunityMode(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (opportunity_mode: ConversationOpportunityMode) => $api(`/api/v1/inbox/channels/${toValue(channelId)}/crm-settings`, {
      method: 'PATCH', body: { opportunity_mode }, schema: InboxChannelCrmSettingsSchema,
    }),
    onSuccess: setting => qc.setQueryData(modeKey(setting.channel_id), setting),
    onError: () => qc.invalidateQueries({ queryKey: modeKey(toValue(channelId)) }),
  })
}
