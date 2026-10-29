import type { MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  InboxBusinessProfileSchema,
  InboxChannelAlertListSchema,
  InboxChannelSchema,
  type InboxBusinessProfilePatch,
  type InboxChannel,
  type InboxDisplayNameRequest,
  type InboxPin,
} from '@webvue/contracts'
import { fileToBase64 } from '../../utils/attachmentFile'
import { inboxSettingsKeys } from './useInboxSettings'

/** Alerts per timeline page. */
export const INBOX_ALERT_PAGE = 20

/** The webhook fields the Meta app must be subscribed to for the channel to hear about its number and account. */
export const WEBHOOK_FIELDS = [
  'messages',
  'message_template_status_update',
  'template_category_update',
  'message_template_quality_update',
  'phone_number_quality_update',
  'phone_number_name_update',
  'account_update',
  'business_capability_update',
  'account_alerts',
  'user_preferences',
] as const

// The alerts share the 'inbox' root of the staff keys, so the bus invalidation refreshes the timeline. The profile is read
// live from Meta (Meta is its only store), so it lives under its own root: an unrelated inbox event never costs a Meta call.
export const inboxHealthKeys = {
  alerts: (channelId: number, offset: number) => ['inbox', 'channel', channelId, 'alerts', offset] as const,
  alertsOf: (channelId: number) => ['inbox', 'channel', channelId, 'alerts'] as const,
  profile: (channelId: number) => ['inbox-profile', channelId] as const,
}

export function useInboxChannelAlerts(channelId: MaybeRefOrGetter<number | null>, offset: MaybeRefOrGetter<number> = 0) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxHealthKeys.alerts(toValue(channelId) ?? 0, toValue(offset))),
    enabled: computed(() => !!toValue(channelId)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/channels/${toValue(channelId)}/alerts`, { query: { limit: INBOX_ALERT_PAGE, offset: toValue(offset) }, schema: InboxChannelAlertListSchema }),
  })
}

/** The business profile as Meta has it now. Never kept: a profile is read fresh each time the page opens. */
export function useInboxBusinessProfile(channelId: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxHealthKeys.profile(toValue(channelId) ?? 0)),
    enabled: computed(() => !!toValue(channelId) && toValue(enabled)),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => $api(`/api/v1/inbox/channels/${toValue(channelId)}/profile`, { schema: InboxBusinessProfileSchema }),
  })
}

export function useSaveInboxBusinessProfile(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxBusinessProfilePatch) => $api(`/api/v1/inbox/channels/${toValue(channelId)}/profile`, { method: 'PATCH', body, schema: InboxBusinessProfileSchema }),
    onSuccess: profile => qc.setQueryData(inboxHealthKeys.profile(toValue(channelId)), profile),
  })
}

/** The picture goes to Meta only (base64 JSON, JPEG or PNG up to 5 MB); the answer is the re-read profile. */
export function useUploadInboxProfilePicture(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => $api(`/api/v1/inbox/channels/${toValue(channelId)}/profile/picture`, {
      method: 'PUT',
      body: { name: file.name, mimetype: file.type, data: await fileToBase64(file) },
      schema: InboxBusinessProfileSchema,
    }),
    onSuccess: profile => qc.setQueryData(inboxHealthKeys.profile(toValue(channelId)), profile),
  })
}

/** Health, name status and analytics state are on the channel; the timeline gains rows. Both are reloaded after an action. */
function useChannelHealthAction<Body, Result extends InboxChannel | void>(channelId: MaybeRefOrGetter<number>, path: string, parse: boolean) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Body) => $api(`/api/v1/inbox/channels/${toValue(channelId)}/${path}`, { method: 'POST', body: body as object, ...(parse ? { schema: InboxChannelSchema } : {}) }) as Promise<Result>,
    onSuccess: async (result) => {
      if (parse && result) qc.setQueryData(inboxSettingsKeys.channel(toValue(channelId)), result)
      await Promise.all([
        qc.invalidateQueries({ queryKey: inboxSettingsKeys.channels }),
        qc.invalidateQueries({ queryKey: inboxHealthKeys.alertsOf(toValue(channelId)) }),
      ])
    },
  })
}

export const useRequestInboxDisplayName = (channelId: MaybeRefOrGetter<number>) => useChannelHealthAction<InboxDisplayNameRequest, InboxChannel>(channelId, 'display-name', true)
/** The PIN is sent once and never kept: the route answers 204. */
export const useSetInboxTwoStepPin = (channelId: MaybeRefOrGetter<number>) => useChannelHealthAction<InboxPin, void>(channelId, 'two-step-pin', false)
export const useRegisterInboxNumber = (channelId: MaybeRefOrGetter<number>) => useChannelHealthAction<InboxPin, InboxChannel>(channelId, 'register', true)
/** The irreversible Meta opt-in for template analytics. */
export const useEnableInboxTemplateInsights = (channelId: MaybeRefOrGetter<number>) => useChannelHealthAction<Record<string, never>, InboxChannel>(channelId, 'template-insights', true)
export const useSyncInboxAnalytics = (channelId: MaybeRefOrGetter<number>) => useChannelHealthAction<Record<string, never>, InboxChannel>(channelId, 'analytics/sync', true)
