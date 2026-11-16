import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  InboxConversationListSchema,
  MeetingDetailSchema,
  MeetingListSchema,
  MyTaskListPageSchema,
  PersonalTaskSchema,
  SalesOrderListSchema,
  SalesOrderSchema,
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

export function useOpportunityOrderAccess() {
  const { can } = useAccess()
  return {
    read: computed(() => can('crm.leads.read') && can('sales.read')),
    write: computed(() => can('crm.leads.read') && can('sales.quotations.manage')),
  }
}

export function useOpportunityConversationAccess() {
  const { can } = useAccess()
  return computed(() => can('crm.leads.read') && can('inbox.conversations.read'))
}

export function useOpportunityConversations(id: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => crmKeys.conversations(toValue(id))),
    enabled: computed(() => toValue(id) > 0 && toValue(enabled)),
    retry: false,
    queryFn: ({ signal }) => $api(`/api/v1/crm/opportunities/${toValue(id)}/conversations`, { query: { limit: OPPORTUNITY_BRIDGE_LIMIT, offset: 0 }, signal, schema: InboxConversationListSchema }),
  })
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

// The quotations and orders of one opportunity, served by the CRM bridge to Sales. Rows the caller cannot read in Sales
// are neither listed nor counted. A new quotation takes the opportunity's customer and starts with no line; the page then
// opens it in Sales to fill in.
export function useOpportunityOrders(id: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => crmKeys.orders(toValue(id))),
    enabled: computed(() => toValue(id) > 0 && toValue(enabled)),
    retry: false,
    queryFn: ({ signal }) => $api(`/api/v1/crm/opportunities/${toValue(id)}/orders`, { query: { limit: OPPORTUNITY_BRIDGE_LIMIT, offset: 0 }, signal, schema: SalesOrderListSchema }),
  })
}

export function useCreateOpportunityOrder(id: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => $api(`/api/v1/crm/opportunities/${toValue(id)}/orders`, { method: 'POST', body: {}, schema: SalesOrderSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.orders(toValue(id)) }),
  })
}
