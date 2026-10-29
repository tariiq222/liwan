import type { MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  InboxCannedReplyListSchema,
  InboxCannedReplySchema,
  InboxChannelListSchema,
  InboxChannelSchema,
  InboxDepartmentListSchema,
  InboxDepartmentSchema,
  InboxAttachmentSchema,
  InboxRefSchema,
  InboxSettingsSchema,
  InboxTagListSchema,
  InboxTagSchema,
  InboxTemplateListSchema,
  InboxTemplateSchema,
  type InboxCannedReplyWrite,
  type InboxChannelCreate,
  type InboxChannelPatch,
  type InboxDepartmentWrite,
  type InboxPresetKey,
  type InboxSettingsPatch,
  type InboxTagWrite,
  type InboxTemplateWrite,
} from '@webvue/contracts'
import { fileToBase64 } from '../../utils/attachmentFile'
import { inboxKeys } from './useInbox'

// Same 'inbox' root as the staff keys, so the bus invalidation of ['inbox'] refreshes the settings too.
export const inboxSettingsKeys = {
  settings: ['inbox', 'settings'] as const,
  departments: ['inbox', 'departments'] as const,
  channels: ['inbox', 'channels'] as const,
  channel: (id: number) => ['inbox', 'channel', id] as const,
  channelRef: (id: number) => ['inbox', 'channel-ref', id] as const,
}

export function useInboxSettings() {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxSettingsKeys.settings,
    queryFn: () => $api('/api/v1/settings/inbox', { schema: InboxSettingsSchema }),
  })
}

export function useUpdateInboxSettings() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxSettingsPatch) => $api('/api/v1/settings/inbox', { method: 'PATCH', body, schema: InboxSettingsSchema }),
    onSuccess: settings => qc.setQueryData(inboxSettingsKeys.settings, settings),
  })
}

/** A sector preset adds its missing departments, tags and canned replies and sets the policy; every list is reloaded. */
export function useApplyInboxPreset() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: InboxPresetKey) => $api(`/api/v1/settings/inbox/presets/${key}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxKeys.all }),
  })
}

export function useInboxDepartments(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxSettingsKeys.departments,
    enabled: computed(() => toValue(enabled)),
    retry: false,
    queryFn: () => $api('/api/v1/inbox/departments', { schema: InboxDepartmentListSchema }),
  })
}

export function useSaveInboxDepartment() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: InboxDepartmentWrite }) => id
      ? $api(`/api/v1/inbox/departments/${id}`, { method: 'PATCH', body, schema: InboxDepartmentSchema })
      : $api('/api/v1/inbox/departments', { method: 'POST', body, schema: InboxDepartmentSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxSettingsKeys.departments }),
  })
}

export function useDeleteInboxDepartment() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/departments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxSettingsKeys.departments }),
  })
}

export function useSaveInboxTag() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: InboxTagWrite }) => id
      ? $api(`/api/v1/inbox/tags/${id}`, { method: 'PATCH', body, schema: InboxTagSchema })
      : $api('/api/v1/inbox/tags', { method: 'POST', body, schema: InboxTagSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxKeys.tags }),
  })
}

export function useDeleteInboxTag() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/tags/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxKeys.tags }),
  })
}

export function useSaveInboxCannedReply() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: InboxCannedReplyWrite }) => id
      ? $api(`/api/v1/inbox/canned-replies/${id}`, { method: 'PATCH', body, schema: InboxCannedReplySchema })
      : $api('/api/v1/inbox/canned-replies', { method: 'POST', body, schema: InboxCannedReplySchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxKeys.canned }),
  })
}

export function useDeleteInboxCannedReply() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/canned-replies/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxKeys.canned }),
  })
}

export function useInboxChannels() {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxSettingsKeys.channels,
    queryFn: () => $api('/api/v1/inbox/channels', { schema: InboxChannelListSchema }),
  })
}

export function useInboxChannel(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxSettingsKeys.channel(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/channels/${toValue(id)}`, { schema: InboxChannelSchema }),
  })
}

export function useCreateInboxChannel() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxChannelCreate) => $api('/api/v1/inbox/channels', { method: 'POST', body, schema: InboxChannelSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxSettingsKeys.channels }),
  })
}

export function usePatchInboxChannel(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxChannelPatch) => $api(`/api/v1/inbox/channels/${toValue(id)}`, { method: 'PATCH', body, schema: InboxChannelSchema }),
    onSuccess: async (channel) => {
      qc.setQueryData(inboxSettingsKeys.channel(channel.id), channel)
      await qc.invalidateQueries({ queryKey: inboxSettingsKeys.channels })
    },
  })
}

export function useDeleteInboxChannel() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxSettingsKeys.channels }),
  })
}

/** The test and the template sync both change what the channel shows (state, last error, templates), so the channel is reloaded. */
function useChannelAction(id: MaybeRefOrGetter<number>, path: 'templates/sync') {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => $api(`/api/v1/inbox/channels/${toValue(id)}/${path}`, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: inboxKeys.all }),
  })
}

export function useTestInboxChannel(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => $api(`/api/v1/inbox/channels/${toValue(id)}/test`, { method: 'POST', schema: InboxChannelSchema }),
    onSettled: () => qc.invalidateQueries({ queryKey: inboxKeys.all }),
  })
}
export const useSyncInboxTemplates = (id: MaybeRefOrGetter<number>) => useChannelAction(id, 'templates/sync')

// ---------------------------------------------------------------- templates (settings)
/** A channel's id and name, readable by whoever manages its templates without administering the channel. */
export function useInboxChannelRef(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxSettingsKeys.channelRef(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/channels/${toValue(id)}/ref`, { schema: InboxRefSchema }),
  })
}

export interface InboxTemplateFilters {
  status?: string
  category?: string
  q?: string
  limit?: number
  offset?: number
}

const cleanFilters = (filters: InboxTemplateFilters) => Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''))

/** One channel's templates with any status, for the templates page. */
export function useInboxChannelTemplates(channelId: MaybeRefOrGetter<number | null>, filters: MaybeRefOrGetter<InboxTemplateFilters>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxKeys.templateList(toValue(channelId) ?? 0, cleanFilters(toValue(filters)))),
    enabled: computed(() => !!toValue(channelId)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/channels/${toValue(channelId)}/templates`, { query: cleanFilters(toValue(filters)), schema: InboxTemplateListSchema }),
  })
}

export function useInboxTemplate(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxKeys.template(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/templates/${toValue(id)}`, { schema: InboxTemplateSchema }),
  })
}

/** Creates a template on the channel (and submits it to Meta), or edits an existing one when `id` is given. */
export function useSaveInboxTemplate(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: InboxTemplateWrite }) => id
      ? $api(`/api/v1/inbox/templates/${id}`, { method: 'PATCH', body, schema: InboxTemplateSchema })
      : $api(`/api/v1/inbox/channels/${toValue(channelId)}/templates`, { method: 'POST', body, schema: InboxTemplateSchema }),
    onSuccess: async (template) => {
      qc.setQueryData(inboxKeys.template(template.id), template)
      await qc.invalidateQueries({ queryKey: inboxKeys.templates(toValue(channelId)) })
    },
  })
}

export function useDeleteInboxTemplate(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/templates/${id}`, { method: 'DELETE' }),
    onSuccess: async (_, id) => {
      qc.removeQueries({ queryKey: inboxKeys.template(id) })
      await qc.invalidateQueries({ queryKey: inboxKeys.templates(toValue(channelId)) })
    },
  })
}

/** Uploads the sample file of a media header, as base64 JSON; the answer is what the template then references by id. */
export function useUploadInboxTemplateSample(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  return useMutation({
    mutationFn: async (file: File) => $api(`/api/v1/inbox/channels/${toValue(channelId)}/templates/uploads`, {
      method: 'POST',
      body: { name: file.name, mimetype: file.type || 'application/octet-stream', data: await fileToBase64(file) },
      schema: InboxAttachmentSchema,
    }),
  })
}
