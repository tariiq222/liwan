import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { leaveApprovalAttention, leaveCancellationAttention } from '../hr/attention'
import { overdueFollowupAttention, todayMeetingsAttention } from '../meetings/attention'
import { pendingReviewAttention } from '../operations/attention'
import { overdueTasksAttention, projectsAtRiskAttention } from '../pmo/attention'
import { myTasksAttention } from '../tasks/attention'
import { attentionProviders } from '../surfaces'
import type { AppAttentionProvider, AppSearchApi } from '../types'

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key)

/** A fetcher that answers every request with `body` after parsing it through the caller's own schema. */
function fakeApi(body: unknown) {
  const api = vi.fn(async (_url: string, options: { schema: { parse: (data: unknown) => unknown } }) => options.schema.parse(body))
  return { api, fetcher: api as unknown as AppSearchApi }
}

const person = { id: 1, name: 'سارة', user_id: 1 }

describe('attention providers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('registers every provider once, each under a rail module of its own application', () => {
    const providers = attentionProviders()
    expect(providers.map(provider => provider.id).sort()).toEqual([
      'hr-leave-approvals', 'hr-leave-cancellations', 'meetings-followup-overdue', 'meetings-today', 'operations-pending', 'pmo-projects-at-risk', 'pmo-tasks-overdue', 'tasks-due',
    ])
    expect(new Set(providers.map(provider => provider.id)).size).toBe(providers.length)
    expect(new Set(providers.map(provider => JSON.stringify(provider.queryKey))).size).toBe(providers.length)
    expect(providers.map(provider => provider.module).sort()).toEqual(['hr', 'hr', 'meetings', 'meetings', 'operations', 'projects', 'projects', 'tasks'])
  })

  describe('tasks', () => {
    const task = (id: number, date_deadline: string | null) => ({ id, name: `مهمة ${id}`, state: 'open', priority: 'normal', date_deadline, assignees: [], source: 'personal', project: null, href: `/my-tasks/${id}` })

    it('lists overdue tasks first as urgent, then today as normal, and ignores later or undated ones', async () => {
      const { api, fetcher } = fakeApi({ items: [task(1, '2026-10-20T12:00:00Z'), task(2, '2026-10-22T12:00:00Z'), task(3, '2026-10-30T12:00:00Z'), task(4, null)], total: 4 })
      const rows = await myTasksAttention.load(fetcher, t)
      expect(api).toHaveBeenCalledWith('/api/v1/my-tasks', expect.objectContaining({ query: { closed: 0, assigned: 'me', sort: 'deadline', limit: 50 } }))
      expect(rows).toEqual([
        { id: 'task-1', recordKey: 'task:1', label: 'مهمة 1', to: '/my-tasks/1', caption: 'myTasks.attention.overdue', tone: 'urgent', suggestion: 'myTasks.attention.startOverdue' },
        { id: 'task-2', recordKey: 'task:2', label: 'مهمة 2', to: '/my-tasks/2', caption: 'myTasks.attention.today', tone: 'normal' },
      ])
    })
    it('gives no suggestion when nothing is overdue and returns at most twenty rows', async () => {
      const { fetcher } = fakeApi({ items: Array.from({ length: 25 }, (_, index) => task(index + 1, '2026-10-22T12:00:00Z')), total: 25 })
      const rows = await myTasksAttention.load(fetcher, t)
      expect(rows).toHaveLength(20)
      expect(rows.every(row => row.tone === 'normal' && row.suggestion === undefined)).toBe(true)
    })
    it('is empty without tasks and passes a failure on', async () => {
      expect(await myTasksAttention.load(fakeApi({ items: [], total: 0 }).fetcher, t)).toEqual([])
      await expect(myTasksAttention.load((async () => { throw new Error('boom') }) as unknown as AppSearchApi, t)).rejects.toThrow('boom')
    })
  })

  describe('operations', () => {
    const request = (id: number) => ({
      id, name: `طلب ${id}`, process: { id: 1, name: 'شراء' }, purpose: 'work', process_revision: 1, state: 'pending', revision: 1, cycle: 1,
      requester: person, created_at: '2026-10-20T10:00:00Z', execution_count: 0,
    })

    it('lists requests waiting for my review as urgent', async () => {
      const { api, fetcher } = fakeApi({ items: [request(7), request(8)], total: 2 })
      const rows = await pendingReviewAttention.load(fetcher, t)
      expect(api).toHaveBeenCalledWith('/api/v1/operations/requests', expect.objectContaining({ query: { scope: 'pending', limit: 20 } }))
      expect(rows).toEqual([
        { id: 'operation-7', label: 'طلب 7', to: '/operations/7', caption: 'operations.attention.from:{"name":"سارة"}', tone: 'urgent' },
        { id: 'operation-8', label: 'طلب 8', to: '/operations/8', caption: 'operations.attention.from:{"name":"سارة"}', tone: 'urgent' },
      ])
    })
    it('is empty without pending requests and passes a failure on', async () => {
      expect(await pendingReviewAttention.load(fakeApi({ items: [], total: 0 }).fetcher, t)).toEqual([])
      await expect(pendingReviewAttention.load((async () => { throw new Error('403') }) as unknown as AppSearchApi, t)).rejects.toThrow('403')
    })
  })

  describe('meetings', () => {
    const meeting = (id: number, state: string, start_datetime: string | null) => ({
      id, name: `اجتماع ${id}`, reference: `M-${id}`, meeting_date: '2026-10-22', start_datetime, end_datetime: null, state,
      organizer: null, open_resolution_count: 0, series_id: null, project_id: null,
    })

    it('lists today\'s confirmed and draft meetings by start time, as normal', async () => {
      const { api, fetcher } = fakeApi({ items: [meeting(1, 'confirmed', '2026-10-22T14:00:00Z'), meeting(2, 'cancelled', null), meeting(3, 'done', null), meeting(4, 'draft', '2026-10-22T08:00:00Z')], total: 4 })
      const rows = await todayMeetingsAttention.load(fetcher, t)
      expect(api).toHaveBeenCalledWith('/api/v1/meetings', expect.objectContaining({ query: expect.objectContaining({ mine: 1, limit: 50 }) }))
      expect(rows.map(row => [row.id, row.to, row.tone])).toEqual([
        ['meeting-4', '/meetings/4', 'normal'],
        ['meeting-1', '/meetings/1', 'normal'],
      ])
      const query = (api.mock.calls[0]![1] as unknown as { query: { date_from: string; date_to: string } }).query
      expect(query.date_from).toBe(query.date_to)
    })
    it('skips a meeting that already ended and keeps one still running or without an end time', async () => {
      const ended = { ...meeting(1, 'confirmed', '2020-01-01T08:00:00Z'), end_datetime: '2020-01-01T09:00:00Z' }
      const running = { ...meeting(2, 'confirmed', '2020-01-01T08:00:00Z'), end_datetime: '2999-01-01T09:00:00Z' }
      const open = meeting(3, 'draft', '2020-01-01T08:00:00Z')
      const rows = await todayMeetingsAttention.load(fakeApi({ items: [ended, running, open], total: 3 }).fetcher, t)
      expect(rows.map(row => row.id)).toEqual(['meeting-2', 'meeting-3'])
    })
    it('is empty without meetings today and passes a failure on', async () => {
      expect(await todayMeetingsAttention.load(fakeApi({ items: [], total: 0 }).fetcher, t)).toEqual([])
      await expect(todayMeetingsAttention.load((async () => { throw new Error('boom') }) as unknown as AppSearchApi, t)).rejects.toThrow('boom')
    })

    const resolution = (id: number) => ({
      id, name: `توصية ${id}`, deadline: '2026-10-01', priority: '1', state: 'open', responsible: null, task_id: null, result: '',
      can_update_execution: true, can_edit_decision: false, meeting_id: 40 + id, meeting_name: `اجتماع ${id}`,
    })

    it('lists my overdue follow-up resolutions as urgent with a suggestion on the first', async () => {
      const { api, fetcher } = fakeApi({ items: [resolution(1), resolution(2)], total: 2 })
      const rows = await overdueFollowupAttention.load(fetcher, t)
      expect(api).toHaveBeenCalledWith('/api/v1/meetings/resolutions', expect.objectContaining({ query: { mine: true, state: 'overdue', limit: 20 } }))
      expect(rows).toEqual([
        { id: 'resolution-1', label: 'توصية 1', to: '/meetings/41', caption: 'اجتماع 1', tone: 'urgent', suggestion: 'meetingsUi.attention.reviewOverdue' },
        { id: 'resolution-2', label: 'توصية 2', to: '/meetings/42', caption: 'اجتماع 2', tone: 'urgent' },
      ])
    })
    it('is empty without overdue resolutions', async () => {
      expect(await overdueFollowupAttention.load(fakeApi({ items: [], total: 0 }).fetcher, t)).toEqual([])
    })
  })

  describe('pmo', () => {
    const task = (id: number) => ({
      id, name: `مهمة ${id}`, description_excerpt: '', project: { id: 5, name: 'مشروع الرياض' }, state: 'in_progress', priority: '1',
      date_deadline: '2026-10-01', days_remaining: -21, is_overdue: true, is_closed: false, personal_stage: null, stage: null, assignees: [], tags: [],
      allowed_transitions: [], subtask_count: 0, subtask_done_count: 0, attachment_count: 0,
    })

    it('lists my overdue project tasks as urgent with a suggestion on the first', async () => {
      const { api, fetcher } = fakeApi({ items: [task(1), task(2)], total: 2 })
      const rows = await overdueTasksAttention.load(fetcher, t)
      expect(rows.map(row => row.recordKey)).toEqual(['task:1', 'task:2'])
      expect(api).toHaveBeenCalledWith('/api/v1/tasks', expect.objectContaining({ query: { filter: 'mine', deadline: 'overdue', sort: 'date_deadline', limit: 20 } }))
      expect(rows).toEqual([
        { id: 'task-1', recordKey: 'task:1', label: 'مهمة 1', to: '/tasks/1', caption: 'مشروع الرياض', tone: 'urgent', suggestion: 'tasks.attention.startOverdue' },
        { id: 'task-2', recordKey: 'task:2', label: 'مهمة 2', to: '/tasks/2', caption: 'مشروع الرياض', tone: 'urgent' },
      ])
    })
    it('is empty without overdue tasks and passes a failure on', async () => {
      expect(await overdueTasksAttention.load(fakeApi({ items: [], total: 0 }).fetcher, t)).toEqual([])
      await expect(overdueTasksAttention.load((async () => { throw new Error('boom') }) as unknown as AppSearchApi, t)).rejects.toThrow('boom')
    })

    const project = (id: number, status: string) => ({
      id, name: `مشروع ${id}`, status, progress: 10, task_count: 2, closed_task_count: 0, active: true, can_manage: false, allowed_actions: [],
      charter_state: 'approved', phase: 'executing',
    })
    const projectsApi = (byStatus: Record<string, unknown[]>) => {
      const api = vi.fn(async (_url: string, options: { query: { status: string }; schema: { parse: (data: unknown) => unknown } }) =>
        options.schema.parse({ items: byStatus[options.query.status] ?? [], total: 0, can_create: false, can_list_archived: false }))
      return { api, fetcher: api as unknown as AppSearchApi }
    }

    it('lists off-track projects before at-risk ones, as normal', async () => {
      const { api, fetcher } = projectsApi({ off_track: [project(1, 'off_track')], at_risk: [project(2, 'at_risk'), project(3, 'at_risk')] })
      const rows = await projectsAtRiskAttention.load(fetcher, t)
      expect(api).toHaveBeenCalledTimes(2)
      expect(rows.map(row => [row.id, row.to, row.caption, row.tone])).toEqual([
        ['project-1', '/projects/1', 'projects.status.off_track', 'normal'],
        ['project-2', '/projects/2', 'projects.status.at_risk', 'normal'],
        ['project-3', '/projects/3', 'projects.status.at_risk', 'normal'],
      ])
    })
    it('is empty when no project is at risk and passes a failure on', async () => {
      expect(await projectsAtRiskAttention.load(projectsApi({}).fetcher, t)).toEqual([])
      await expect(projectsAtRiskAttention.load((async () => { throw new Error('boom') }) as unknown as AppSearchApi, t)).rejects.toThrow('boom')
    })
  })

  describe('hr', () => {
    const leave = (id: number, can_approve: boolean, state = 'confirm') => ({
      id, employee: { id: 10 + id, name: `موظف ${id}` }, leave_type: { id: 1, name: 'إجازة سنوية' }, date_from: '2026-11-01', date_to: '2026-11-03',
      number_of_days: 3, state, notes: '', can_approve, can_refuse: can_approve, can_cancel: false, can_withdraw: false,
      cancellation_policy: 'manager_approval', cancellation: null, can_request_cancellation: false, can_approve_cancellation: false, can_refuse_cancellation: false,
    })

    it('lists only the leave requests I can approve, as urgent', async () => {
      const { api, fetcher } = fakeApi({ items: [leave(1, true), leave(2, false), leave(3, true, 'validate1')], total: 3 })
      const rows = await leaveApprovalAttention.load(fetcher, t)
      expect(api).toHaveBeenCalledWith('/api/v1/hr/leave/requests', expect.objectContaining({ query: { state: 'confirm,validate1', limit: 50 } }))
      expect(rows.map(row => [row.id, row.label, row.to, row.tone])).toEqual([
        ['leave-1', 'موظف 1 · إجازة سنوية', '/hr/leave/1', 'urgent'],
        ['leave-3', 'موظف 3 · إجازة سنوية', '/hr/leave/3', 'urgent'],
      ])
      expect(rows[0]!.caption).toContain('01/11/2026')
    })
    const pending = (id: number, canApprove: boolean, canRefuse: boolean) => ({ ...leave(id, false, 'validate'), cancellation: { id: id + 100, state: 'pending', revision: 1, reason: 'Plans changed', requested_at: '2026-10-22 10:00:00', initiator: { id: person.id, name: person.name }, reviewed_at: null, reviewer: null, review_reason: null }, can_approve_cancellation: canApprove, can_refuse_cancellation: canRefuse })

    it('includes only actionable pending cancellations and returns to their own queue', async () => {
      const { api, fetcher } = fakeApi({ items: [pending(1, true, true), pending(2, false, false), pending(3, false, true)], total: 3 })
      const rows = await leaveCancellationAttention.load(fetcher, t)
      expect(api).toHaveBeenCalledWith('/api/v1/hr/leave/requests', expect.objectContaining({ query: { cancellation_state: 'pending', limit: 50 } }))
      expect(rows.map(row => row.id)).toEqual(['leave-cancellation-1', 'leave-cancellation-3'])
      expect(rows[0]!.label).toContain('hr.leave.cancellationStates.pending')
      expect(rows.every(row => row.to.endsWith('?returnTo=%2Fhr%2Fleave%3Fcancellation_state%3Dpending') && row.tone === 'urgent')).toBe(true)
    })
    it('keeps cancellation attention bounded and propagates failures', async () => {
      expect(await leaveCancellationAttention.load(fakeApi({ items: [], total: 0 }).fetcher, t)).toEqual([])
      expect(await leaveCancellationAttention.load(fakeApi({ items: Array.from({ length: 25 }, (_, i) => pending(i + 1, true, true)), total: 25 }).fetcher, t)).toHaveLength(20)
      await expect(leaveCancellationAttention.load((async () => { throw new Error('403') }) as unknown as AppSearchApi, t)).rejects.toThrow('403')
    })
    it('is empty when nothing awaits me, returns at most twenty and passes a failure on', async () => {
      expect(await leaveApprovalAttention.load(fakeApi({ items: [leave(1, false)], total: 1 }).fetcher, t)).toEqual([])
      const many = fakeApi({ items: Array.from({ length: 25 }, (_, index) => leave(index + 1, true)), total: 25 })
      expect(await leaveApprovalAttention.load(many.fetcher, t)).toHaveLength(20)
      await expect(leaveApprovalAttention.load((async () => { throw new Error('403') }) as unknown as AppSearchApi, t)).rejects.toThrow('403')
    })
  })

  it('gives every provider the work kind its rows ask for', () => {
    const kinds = Object.fromEntries(attentionProviders().map(provider => [provider.id, provider.work]))
    expect(kinds).toEqual({
      'tasks-due': 'execute',
      'pmo-tasks-overdue': 'execute',
      'meetings-followup-overdue': 'execute',
      'operations-pending': 'decide',
      'hr-leave-approvals': 'decide',
      'hr-leave-cancellations': 'decide',
      'pmo-projects-at-risk': 'follow',
      'meetings-today': 'follow',
    })
  })

  it('keeps every provider on its own capability and never touches payroll or compensation', () => {
    const providers: AppAttentionProvider[] = attentionProviders()
    for (const provider of providers) expect(provider.capability).not.toMatch(/^hr\.payroll/)
    expect(providers.find(provider => provider.id === 'hr-leave-approvals')?.capability).toBe('hr.leave.approve')
  })
})
