import { QueryClient } from '@tanstack/vue-query'
import { describe, expect, it } from 'vitest'
import { leaveApprovalAttention } from '../hr/attention'
import { todayMeetingsAttention, overdueFollowupAttention } from '../meetings/attention'
import { pendingReviewAttention } from '../operations/attention'
import { overdueTasksAttention, projectsAtRiskAttention } from '../pmo/attention'
import { invalidateTaskLists } from '../../composables/useTasks'
import { invalidateMeetingCaches } from '../../composables/meetingKeys'
import { invalidateProjectCaches } from '../../composables/projectKeys'

describe('attention follows application cache invalidation', () => {
  it.each([
    [leaveApprovalAttention, ['hr', 'leave']],
    [todayMeetingsAttention, ['meetings']],
    [overdueFollowupAttention, ['meetings']],
    [pendingReviewAttention, ['operations', 'requests', 'list']],
  ] as const)('invalidates $0.id with its owning collection', async (provider, queryKey) => {
    const client = new QueryClient()
    client.setQueryData(provider.queryKey, [{ id: 'stale' }])
    await client.invalidateQueries({ queryKey })
    expect(client.getQueryState(provider.queryKey)?.isInvalidated).toBe(true)
    client.clear()
  })

  it('invalidates project task and project attention through their existing mutation helpers', async () => {
    const client = new QueryClient()
    for (const provider of [overdueTasksAttention, projectsAtRiskAttention]) client.setQueryData(provider.queryKey, [{ id: 'stale' }])
    invalidateTaskLists(client)
    await invalidateProjectCaches(client)
    expect(client.getQueryState(overdueTasksAttention.queryKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(projectsAtRiskAttention.queryKey)?.isInvalidated).toBe(true)
    client.clear()
  })

  it('refreshes both meeting attention providers after a meeting changes', async () => {
    const client = new QueryClient()
    for (const provider of [todayMeetingsAttention, overdueFollowupAttention]) client.setQueryData(provider.queryKey, [{ id: 'stale' }])
    await invalidateMeetingCaches(client)
    expect(client.getQueryState(todayMeetingsAttention.queryKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(overdueFollowupAttention.queryKey)?.isInvalidated).toBe(true)
    client.clear()
  })
})
