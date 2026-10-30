import { describe, expect, it } from 'vitest'
import { projectStatusBadge } from '../../composables/projectStatus'
import { taskStateBadge } from '../../composables/taskState'
import { accessStateBadge } from '../accessStateBadge'
import { hrAccessBadge } from '../hrAccessBadge'
import { badgeLabel, statusBadgeEntry } from '@liwan/ui/app/utils/statusBadge'
import { subscriptionStateBadge } from '../subscription'

const t = (key: string) => `t:${key}`

describe('status badge maps keep the colours and labels the old components had', () => {
  it.each([
    [projectStatusBadge('on_track'), 'success', 'projects.status.on_track'],
    [projectStatusBadge('off_track'), 'destructive', 'projects.status.off_track'],
    [taskStateBadge('changes_requested'), 'warning', 'tasks.state.changes_requested'],
    [taskStateBadge('cancelled'), 'destructive', 'tasks.state.cancelled'],
    [accessStateBadge({ active: true, protected: true }), 'primary', 'access.protected'],
    [accessStateBadge({ active: false, readOnly: true }), 'neutral', 'access.readOnly'],
    [accessStateBadge({ active: true }), 'success', 'access.active'],
    [accessStateBadge({ active: false }), 'warning', 'access.disabled'],
    [hrAccessBadge(null), 'neutral', 'hr.directory.access.noAccount'],
    [hrAccessBadge({ user_id: 9, login: 'm', role: 'employee', active: false }), 'warning', 'hr.directory.access.stopped'],
    [hrAccessBadge({ user_id: 2, login: 'a', role: 'admin', active: true }), 'primary', 'hr.directory.access.admin'],
    [hrAccessBadge({ user_id: 3, login: 'e', role: 'employee', active: true }), 'success', 'hr.directory.access.employee'],
    [subscriptionStateBadge('failed'), 'destructive', 'subscription.state.failed'],
    [subscriptionStateBadge('awaiting_payment'), 'warning', 'subscription.state.awaitingPayment'],
  ] as const)('%o', (entry, tone, labelKey) => {
    expect(entry).toEqual({ tone, labelKey })
  })

  it('labels a project without a status as unset', () => {
    expect(projectStatusBadge(null).tone).toBe('neutral')
    expect(projectStatusBadge(null).labelKey).toMatch(/^projects\.status\./)
  })

  it('an unknown value falls back to a neutral badge that shows the value', () => {
    const map = { done: { tone: 'success', labelKey: 'tasks.state.done' } } as const
    const unknown = statusBadgeEntry(map, 'archived_by_server')
    expect(unknown).toEqual({ tone: 'neutral', labelKey: '' })
    expect(badgeLabel(unknown, 'archived_by_server', t)).toBe('archived_by_server')
    expect(badgeLabel(statusBadgeEntry(map, 'done'), 'done', t)).toBe('t:tasks.state.done')
    expect(badgeLabel(statusBadgeEntry(map, null), null, t)).toBe('—')
    expect(taskStateBadge('new_server_state' as never)).toEqual({ tone: 'neutral', labelKey: '' })
  })
})
