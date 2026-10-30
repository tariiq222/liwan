import type { MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  InboxAttachmentSchema,
  InboxAudienceListSchema,
  InboxAudienceMemberListSchema,
  InboxAudienceSchema,
  InboxCampaignListSchema,
  InboxCampaignPreviewSchema,
  InboxCampaignRecipientListSchema,
  InboxCampaignSchema,
  InboxCampaignSettingsSchema,
  InboxCampaignTestResultSchema,
  InboxChannelSendingSchema,
  InboxContactImportResultSchema,
  InboxContactMarketingSchema,
  InboxRefListSchema,
  type InboxAudienceWrite,
  type InboxCampaignPatch,
  type InboxCampaignPreviewRequest,
  type InboxCampaignSettingsPatch,
  type InboxCampaignWrite,
  type InboxChannelSendingPatch,
  type InboxContactImport,
  type InboxContactMarketingPatch,
} from '@liwan/contracts'
import { hasFeature } from '@/modules/registry'
import { fileToBase64 } from '../../utils/attachmentFile'
import { campaignPollInterval, type CampaignAction } from './inboxCampaignPresentation'
import {
  audienceListQuery, campaignListQuery, memberQuery, recipientQuery,
  type AudienceListRoute, type CampaignListRoute, type MemberRoute, type RecipientRoute,
} from './inboxCampaignRoute'

// Every key starts with 'inbox', so the bus handler's invalidation of ['inbox'] refreshes the campaign screens too.
export const inboxCampaignKeys = {
  campaigns: ['inbox', 'campaigns'] as const,
  list: (route: CampaignListRoute) => ['inbox', 'campaigns', 'list', campaignListQuery(route)] as const,
  detail: (id: number) => ['inbox', 'campaigns', 'detail', id] as const,
  recipients: (id: number, route: RecipientRoute) => ['inbox', 'campaigns', 'recipients', id, recipientQuery(route)] as const,
  recipientsOf: (id: number) => ['inbox', 'campaigns', 'recipients', id] as const,
  preview: (request: InboxCampaignPreviewRequest) => ['inbox', 'campaigns', 'preview', request] as const,
  channels: ['inbox', 'campaign-channels'] as const,
  audiences: ['inbox', 'audiences'] as const,
  audienceList: (route: AudienceListRoute) => ['inbox', 'audiences', 'list', audienceListQuery(route)] as const,
  audience: (id: number) => ['inbox', 'audiences', 'detail', id] as const,
  members: (id: number, route: MemberRoute) => ['inbox', 'audiences', 'members', id, memberQuery(route)] as const,
  sending: (channelId: number) => ['inbox', 'channel', channelId, 'sending'] as const,
  settings: ['inbox', 'campaign-settings'] as const,
  marketing: (contactId: number) => ['inbox', 'contact', contactId, 'marketing'] as const,
}

const MAX_PICKER = 200

/** Whether this tenant has the campaigns feature: the sending section and the contact marketing panel are shown only then. */
export function useInboxCampaignsEnabled() {
  const { me } = useMe()
  return computed(() => hasFeature(me.value, 'inbox.campaigns'))
}

// ---------------------------------------------------------------- campaigns

/** The channels a campaign may be sent from (id and name): the automation route lists them without channel administration. */
export function useInboxCampaignChannels() {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxCampaignKeys.channels,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/automation/channels', { schema: InboxRefListSchema }),
  })
}

export function useInboxCampaignList(route: MaybeRefOrGetter<CampaignListRoute>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCampaignKeys.list(toValue(route))),
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/campaigns', { query: campaignListQuery(toValue(route)), schema: InboxCampaignListSchema }),
  })
}

/** One campaign. While it is scheduled or running it is refetched every 10 s (TanStack pauses it in a hidden tab). */
export function useInboxCampaign(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCampaignKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    refetchInterval: query => campaignPollInterval(query.state.data?.state),
    queryFn: () => $api(`/api/v1/inbox/campaigns/${toValue(id)}`, { schema: InboxCampaignSchema }),
  })
}

export function useInboxCampaignRecipients(id: MaybeRefOrGetter<number | null>, route: MaybeRefOrGetter<RecipientRoute>, poll: MaybeRefOrGetter<boolean> = false) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCampaignKeys.recipients(toValue(id) ?? 0, toValue(route))),
    enabled: computed(() => !!toValue(id)),
    placeholderData: keepPreviousData,
    retry: false,
    refetchInterval: () => (toValue(poll) ? campaignPollInterval('running') : false),
    queryFn: () => $api(`/api/v1/inbox/campaigns/${toValue(id)}/recipients`, { query: recipientQuery(toValue(route)), schema: InboxCampaignRecipientListSchema }),
  })
}

/** Creates a campaign, or edits the one given by `id`. */
export function useSaveInboxCampaign() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: InboxCampaignWrite | InboxCampaignPatch }) => id
      ? $api(`/api/v1/inbox/campaigns/${id}`, { method: 'PATCH', body, schema: InboxCampaignSchema })
      : $api('/api/v1/inbox/campaigns', { method: 'POST', body, schema: InboxCampaignSchema }),
    onSuccess: (campaign) => {
      qc.setQueryData(inboxCampaignKeys.detail(campaign.id), campaign)
      return qc.invalidateQueries({ queryKey: [...inboxCampaignKeys.campaigns, 'list'] })
    },
  })
}

export function useDeleteInboxCampaign() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: inboxCampaignKeys.detail(id) })
      return qc.invalidateQueries({ queryKey: inboxCampaignKeys.campaigns })
    },
  })
}

/** Launch, pause, resume, cancel or retry the frequency-capped recipients. The answer is the campaign. */
export function useInboxCampaignAction(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: CampaignAction) => $api(`/api/v1/inbox/campaigns/${toValue(id)}/${action}`, { method: 'POST', schema: InboxCampaignSchema }),
    onSuccess: async (campaign) => {
      qc.setQueryData(inboxCampaignKeys.detail(campaign.id), campaign)
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...inboxCampaignKeys.campaigns, 'list'] }),
        qc.invalidateQueries({ queryKey: inboxCampaignKeys.recipientsOf(campaign.id) }),
      ])
    },
  })
}

export function useTestInboxCampaign(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  return useMutation({
    mutationFn: (contactId: number) => $api(`/api/v1/inbox/campaigns/${toValue(id)}/test`, {
      method: 'POST', body: { contact_id: contactId }, schema: InboxCampaignTestResultSchema,
    }),
  })
}

/** The header file of a media template, as base64 JSON; the answer is what the campaign then references by id. */
export function useUploadInboxCampaignHeader() {
  const { $api } = useApi()
  return useMutation({
    mutationFn: async (file: File) => $api('/api/v1/inbox/campaigns/uploads', {
      method: 'POST',
      body: { name: file.name, mimetype: file.type || 'application/octet-stream', data: await fileToBase64(file) },
      schema: InboxAttachmentSchema,
    }),
  })
}

/** The template rendered for a sample contact: the server writes nothing. Not requested while `request` is null. */
export function useInboxCampaignPreview(request: MaybeRefOrGetter<InboxCampaignPreviewRequest | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCampaignKeys.preview(toValue(request) ?? ({} as InboxCampaignPreviewRequest))),
    enabled: computed(() => !!toValue(request)),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
    queryFn: () => $api('/api/v1/inbox/campaigns/preview', { method: 'POST', body: toValue(request)!, schema: InboxCampaignPreviewSchema }),
  })
}

// ---------------------------------------------------------------- audiences and contact import

export function useInboxAudienceList(route: MaybeRefOrGetter<AudienceListRoute>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCampaignKeys.audienceList(toValue(route))),
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/audiences', { query: audienceListQuery(toValue(route)), schema: InboxAudienceListSchema }),
  })
}

/** Every audience, for the campaign form's picker. */
export function useInboxAudienceChoices() {
  const { $api } = useApi()
  return useQuery({
    queryKey: [...inboxCampaignKeys.audiences, 'choices'],
    retry: false,
    queryFn: () => $api('/api/v1/inbox/audiences', { query: { limit: MAX_PICKER }, schema: InboxAudienceListSchema }),
  })
}

export function useInboxAudience(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCampaignKeys.audience(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/audiences/${toValue(id)}`, { schema: InboxAudienceSchema }),
  })
}

export function useInboxAudienceMembers(id: MaybeRefOrGetter<number | null>, route: MaybeRefOrGetter<MemberRoute>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCampaignKeys.members(toValue(id) ?? 0, toValue(route))),
    enabled: computed(() => !!toValue(id)),
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/audiences/${toValue(id)}/members`, { query: memberQuery(toValue(route)), schema: InboxAudienceMemberListSchema }),
  })
}

/** Creates an audience, or edits the one given by `id`. */
export function useSaveInboxAudience() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: InboxAudienceWrite | Partial<InboxAudienceWrite> }) => id
      ? $api(`/api/v1/inbox/audiences/${id}`, { method: 'PATCH', body, schema: InboxAudienceSchema })
      : $api('/api/v1/inbox/audiences', { method: 'POST', body, schema: InboxAudienceSchema }),
    onSuccess: (audience) => {
      qc.setQueryData(inboxCampaignKeys.audience(audience.id), audience)
      return qc.invalidateQueries({ queryKey: inboxCampaignKeys.audiences })
    },
  })
}

export function useDeleteInboxAudience() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/audiences/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: inboxCampaignKeys.audience(id) })
      return qc.invalidateQueries({ queryKey: inboxCampaignKeys.audiences })
    },
  })
}

/** The contacts CSV, as base64 JSON. Imported contacts change every audience's counts, so they are reloaded. */
export function useImportInboxContacts() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxContactImport) => $api('/api/v1/inbox/contacts/import', { method: 'POST', body, schema: InboxContactImportResultSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxCampaignKeys.audiences }),
  })
}

// ---------------------------------------------------------------- channel sending, settings, contact consent

export function useInboxChannelSending(channelId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCampaignKeys.sending(toValue(channelId) ?? 0)),
    enabled: computed(() => !!toValue(channelId)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/channels/${toValue(channelId)}/sending`, { schema: InboxChannelSendingSchema }),
  })
}

export function usePatchInboxChannelSending(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxChannelSendingPatch) => $api(`/api/v1/inbox/channels/${toValue(channelId)}/sending`, { method: 'PATCH', body, schema: InboxChannelSendingSchema }),
    onSuccess: sending => qc.setQueryData(inboxCampaignKeys.sending(toValue(channelId)), sending),
  })
}

/** Asks Meta again for the limit, quality and Marketing Messages API onboarding. */
export function useRefreshInboxChannelSending(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => $api(`/api/v1/inbox/channels/${toValue(channelId)}/sending/refresh`, { method: 'POST', schema: InboxChannelSendingSchema }),
    onSuccess: sending => qc.setQueryData(inboxCampaignKeys.sending(toValue(channelId)), sending),
  })
}

export function useInboxCampaignSettings() {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxCampaignKeys.settings,
    retry: false,
    queryFn: () => $api('/api/v1/settings/inbox/campaigns', { schema: InboxCampaignSettingsSchema }),
  })
}

export function useUpdateInboxCampaignSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxCampaignSettingsPatch) => $api('/api/v1/settings/inbox/campaigns', { method: 'PATCH', body, schema: InboxCampaignSettingsSchema }),
    onSuccess: (settings) => {
      qc.setQueryData(inboxCampaignKeys.settings, settings)
      return qc.invalidateQueries({ queryKey: inboxCampaignKeys.audiences })
    },
  })
}

export function useInboxContactMarketing(contactId: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxCampaignKeys.marketing(toValue(contactId) ?? 0)),
    enabled: computed(() => !!toValue(contactId) && toValue(enabled)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/contacts/${toValue(contactId)}/marketing`, { schema: InboxContactMarketingSchema }),
  })
}

export function usePatchInboxContactMarketing(contactId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxContactMarketingPatch) => $api(`/api/v1/inbox/contacts/${toValue(contactId)}/marketing`, { method: 'PATCH', body, schema: InboxContactMarketingSchema }),
    onSuccess: (marketing) => {
      qc.setQueryData(inboxCampaignKeys.marketing(toValue(contactId)), marketing)
      return qc.invalidateQueries({ queryKey: inboxCampaignKeys.audiences })
    },
  })
}
