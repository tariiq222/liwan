import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  MeetingDetailSchema,
  MeetingListSchema,
  MyTaskListPageSchema,
  PersonalTaskSchema,
  type CrmOpportunityMeetingCreate,
  type CrmOpportunityTaskCreate,
} from '@liwan/contracts'
import { crmKeys } from './crmKeys'

// The tasks and the meetings of one opportunity, served by the CRM bridges to those applications. A section is read and
// written only while the tenant has the other application and the user holds both applications' capabilities; the
// server checks the same pairs, so a refusal (403) leaves the page as it is.

/** Rows per section; the bridges page the same way as the applications' own lists. */
export const OPPORTUNITY_BRIDGE_LIMIT = 50

export function useOpportunityTaskAccess() {
  const { can } = useAccess()
  return {
    read: computed(() => can('crm.leads.read') && can('tasks.tasks.read')),
    write: computed(() => can('crm.leads.work') && can('tasks.tasks.create')),
  }
}

export function useOpportunityMeetingAccess() {
  const { can } = useAccess()
  return {
    read: computed(() => can('crm.leads.read') && can('meetings.read')),
    write: computed(() => can('crm.leads.work') && can('meetings.create')),
  }
}

export function useOpportunityTasks(id: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => crmKeys.tasks(toValue(id))),
    enabled: computed(() => toValue(id) > 0 && toValue(enabled)),
    retry: false,
    queryFn: ({ signal }) => $api(`/api/v1/crm/opportunities/${toValue(id)}/tasks`, { query: { limit: OPPORTUNITY_BRIDGE_LIMIT, offset: 0 }, signal, schema: MyTaskListPageSchema }),
  })
}

export function useCreateOpportunityTask(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CrmOpportunityTaskCreate) => $api(`/api/v1/crm/opportunities/${toValue(id)}/tasks`, { method: 'POST', body, schema: PersonalTaskSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.tasks(toValue(id)) }),
  })
}

export function useOpportunityMeetings(id: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => crmKeys.meetings(toValue(id))),
    enabled: computed(() => toValue(id) > 0 && toValue(enabled)),
    retry: false,
    queryFn: ({ signal }) => $api(`/api/v1/crm/opportunities/${toValue(id)}/meetings`, { query: { limit: OPPORTUNITY_BRIDGE_LIMIT, offset: 0 }, signal, schema: MeetingListSchema }),
  })
}

export function useCreateOpportunityMeeting(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CrmOpportunityMeetingCreate) => $api(`/api/v1/crm/opportunities/${toValue(id)}/meetings`, { method: 'POST', body, schema: MeetingDetailSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.meetings(toValue(id)) }),
  })
}
