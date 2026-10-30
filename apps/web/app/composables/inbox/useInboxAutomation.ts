import type { MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  InboxChannelAutomationSchema,
  InboxDepartmentWorkingHoursSchema,
  InboxRefListSchema,
  InboxRuleListSchema,
  InboxRuleSchema,
  InboxRuleTestResultSchema,
  InboxWorkingHoursSchema,
  type InboxChannelAutomation,
  type InboxRuleTest,
  type InboxRuleWrite,
  type InboxWorkingHours,
} from '@liwan/contracts'

// Same 'inbox' root as the staff keys, so the bus invalidation of ['inbox'] refreshes the automation screens too.

export const inboxAutomationKeys = {
  channels: ['inbox', 'automation-channels'] as const,
  hours: ['inbox', 'working-hours'] as const,
  departmentHours: (id: number) => ['inbox', 'working-hours', 'department', id] as const,
  automation: (channelId: number) => ['inbox', 'automation', channelId] as const,
  rules: ['inbox', 'rules'] as const,
  rule: (id: number) => ['inbox', 'rules', id] as const,
}

/** The channels an automation manager may pick (id and name only): the channel list itself needs the channel-admin capability. */
export function useInboxAutomationChannels() {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxAutomationKeys.channels,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/automation/channels', { schema: InboxRefListSchema }),
  })
}

export function useInboxWorkingHours() {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxAutomationKeys.hours,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/working-hours', { schema: InboxWorkingHoursSchema }),
  })
}

export function useSaveInboxWorkingHours() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxWorkingHours) => $api('/api/v1/inbox/working-hours', { method: 'PUT', body, schema: InboxWorkingHoursSchema }),
    onSuccess: hours => qc.setQueryData(inboxAutomationKeys.hours, hours),
  })
}

/** A department's own hours; `working_hours` is null while it follows the company's. */
export function useInboxDepartmentWorkingHours(departmentId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxAutomationKeys.departmentHours(toValue(departmentId) ?? 0)),
    enabled: computed(() => !!toValue(departmentId)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/departments/${toValue(departmentId)}/working-hours`, { schema: InboxDepartmentWorkingHoursSchema }),
  })
}

export function useSaveInboxDepartmentWorkingHours(departmentId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (workingHours: InboxWorkingHours | null) => $api(`/api/v1/inbox/departments/${toValue(departmentId)}/working-hours`, {
      method: 'PUT', body: { working_hours: workingHours }, schema: InboxDepartmentWorkingHoursSchema,
    }),
    onSuccess: value => qc.setQueryData(inboxAutomationKeys.departmentHours(toValue(departmentId)), value),
  })
}

export function useInboxChannelAutomation(channelId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxAutomationKeys.automation(toValue(channelId) ?? 0)),
    enabled: computed(() => !!toValue(channelId)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/channels/${toValue(channelId)}/automation`, { schema: InboxChannelAutomationSchema }),
  })
}

export function useSaveInboxChannelAutomation(channelId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InboxChannelAutomation) => $api(`/api/v1/inbox/channels/${toValue(channelId)}/automation`, { method: 'PATCH', body, schema: InboxChannelAutomationSchema }),
    onSuccess: automation => qc.setQueryData(inboxAutomationKeys.automation(toValue(channelId)), automation),
  })
}

/** Every rule needs to be loaded for the reorder (it sends all ids), so the list asks for the route's whole cap. */
export const INBOX_RULES_LIMIT = 500

export function useInboxRules() {
  const { $api } = useApi()
  return useQuery({
    queryKey: inboxAutomationKeys.rules,
    retry: false,
    queryFn: () => $api('/api/v1/inbox/rules', { query: { limit: INBOX_RULES_LIMIT }, schema: InboxRuleListSchema }),
  })
}

export function useInboxRule(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => inboxAutomationKeys.rule(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    retry: false,
    queryFn: () => $api(`/api/v1/inbox/rules/${toValue(id)}`, { schema: InboxRuleSchema }),
  })
}

/** Creates a rule, or edits the one given by `id` (a partial body is allowed on edit, e.g. only `active`). */
export function useSaveInboxRule() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: InboxRuleWrite | Partial<InboxRuleWrite> }) => id
      ? $api(`/api/v1/inbox/rules/${id}`, { method: 'PATCH', body, schema: InboxRuleSchema })
      : $api('/api/v1/inbox/rules', { method: 'POST', body, schema: InboxRuleSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxAutomationKeys.rules }),
  })
}

export function useDeleteInboxRule() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/inbox/rules/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: inboxAutomationKeys.rule(id) })
      return qc.invalidateQueries({ queryKey: inboxAutomationKeys.rules })
    },
  })
}

export function useReorderInboxRules() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => $api('/api/v1/inbox/rules/reorder', { method: 'POST', body: { ids }, schema: InboxRuleListSchema }),
    onSuccess: list => qc.setQueryData(inboxAutomationKeys.rules, list),
    onSettled: () => qc.invalidateQueries({ queryKey: inboxAutomationKeys.rules }),
  })
}

/** The dry run behind the "try it" box: nothing is sent or changed. */
export function useTestInboxRules() {
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: InboxRuleTest) => $api('/api/v1/inbox/rules/test', { method: 'POST', body, schema: InboxRuleTestResultSchema }),
  })
}
