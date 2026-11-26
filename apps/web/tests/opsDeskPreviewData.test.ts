import { describe, expect, it } from 'vitest'
import {
  AppointmentBookingListSchema,
  AppointmentTypeListSchema,
  HelpdeskReferenceSchema,
  HelpdeskSummarySchema,
  HelpdeskTicketPageSchema,
  OperationProcessListSchema,
  OperationRequestListSchema,
} from '@liwan/contracts'
import { opsDeskPreviewData } from '../e2e/ops-desk-ui-preview-data.mjs'

const call = (pathWithQuery: string) => {
  const url = new URL(pathWithQuery, 'http://preview.local')
  return opsDeskPreviewData(url.pathname, url)
}

describe('opsDeskPreviewData contract and filtering', () => {
  it('returns undefined for unrelated paths', () => {
    expect(call('/api/v1/projects')).toBeUndefined()
    expect(call('/api/v1/crm/opportunities')).toBeUndefined()
  })

  it('returns strict operations requests with filtering, search, and pagination', () => {
    const full = OperationRequestListSchema.parse(call('/api/v1/operations/requests?purpose=work'))
    expect(full.total).toBe(5)
    expect(full.items).toHaveLength(5)
    expect(full.items.every(item => item.purpose === 'work')).toBe(true)
    expect(full.items.some(item => item.name.length >= 60)).toBe(true)

    const byState = OperationRequestListSchema.parse(call('/api/v1/operations/requests?state=pending'))
    expect(byState.total).toBe(2)
    expect(byState.items.every(item => item.state === 'pending')).toBe(true)

    const byPendingScope = OperationRequestListSchema.parse(call('/api/v1/operations/requests?scope=pending&limit=1'))
    expect(byPendingScope.total).toBe(2)
    expect(byPendingScope.items).toHaveLength(1)
    expect(byPendingScope.items[0]?.state).toBe('pending')

    for (const state of ['returned', 'done', 'rejected'] as const) {
      const single = OperationRequestListSchema.parse(call(`/api/v1/operations/requests?state=${state}`))
      expect(single.total).toBe(1)
      expect(single.items[0]?.state).toBe(state)
    }

    const byQuery = OperationRequestListSchema.parse(call('/api/v1/operations/requests?q=السحابي'))
    expect(byQuery.total).toBe(1)
    expect(byQuery.items[0]?.id).toBe(102)

    const byRequester = OperationRequestListSchema.parse(call('/api/v1/operations/requests?q=خالد'))
    expect(byRequester.total).toBe(1)
    expect(byRequester.items[0]?.id).toBe(103)

    const paged = OperationRequestListSchema.parse(call('/api/v1/operations/requests?limit=1&offset=1'))
    expect(paged.total).toBe(5)
    expect(paged.items).toHaveLength(1)
    expect(paged.items[0]?.id).toBe(102)
  })

  it('returns strict published operations processes', () => {
    const processes = OperationProcessListSchema.parse(call('/api/v1/operations/processes'))
    expect(processes.total).toBe(2)
    expect(processes.items).toHaveLength(2)
    expect(processes.items.every(item => item.state === 'published')).toBe(true)
  })

  it('returns strict helpdesk reference, summary, and filtered ticket lists', () => {
    const reference = HelpdeskReferenceSchema.parse(call('/api/v1/helpdesk/reference'))
    expect(reference.stages.filter(stage => !stage.closed)).toHaveLength(3)
    expect(reference.stages.filter(stage => stage.closed)).toHaveLength(1)
    expect(reference.teams.length).toBeGreaterThanOrEqual(2)

    const openPage = HelpdeskTicketPageSchema.parse(call('/api/v1/helpdesk/tickets'))
    expect(openPage.total).toBe(4)
    expect(openPage.items).toHaveLength(4)
    expect(openPage.items.every(ticket => !ticket.stage.closed)).toBe(true)
    expect(openPage.items.some(ticket => ticket.subject.length >= 70)).toBe(true)

    const closedPage = HelpdeskTicketPageSchema.parse(call('/api/v1/helpdesk/tickets?state=closed'))
    expect(closedPage.total).toBe(1)
    expect(closedPage.items[0]?.stage.closed).toBe(true)

    const allPage = HelpdeskTicketPageSchema.parse(call('/api/v1/helpdesk/requests?state=all'))
    expect(allPage.total).toBe(5)
    expect(allPage.items.map(ticket => ticket.number)).toEqual(['HD-0041', 'HD-0042', 'HD-0043', 'HD-0044', 'HD-0045'])

    const summary = HelpdeskSummarySchema.parse(call('/api/v1/helpdesk/summary'))
    expect(summary).toEqual({
      open: openPage.items.length,
      unassigned: openPage.items.filter(ticket => ticket.assignee === null).length,
      mine: openPage.items.filter(ticket => ticket.assignee?.id === 1).length,
      overdue: openPage.items.filter(ticket => ticket.sla.state === 'overdue').length,
    })

    const byPriority = HelpdeskTicketPageSchema.parse(call('/api/v1/helpdesk/tickets?priority=urgent'))
    expect(byPriority.total).toBe(1)
    expect(byPriority.items[0]?.number).toBe('HD-0041')

    const mine = HelpdeskTicketPageSchema.parse(call('/api/v1/helpdesk/tickets?assignee=me'))
    expect(mine.total).toBe(summary.mine)
    expect(mine.items.every(ticket => ticket.assignee?.id === 1)).toBe(true)

    const unassigned = HelpdeskTicketPageSchema.parse(call('/api/v1/helpdesk/tickets?assignee=none'))
    expect(unassigned.total).toBe(summary.unassigned)
    expect(unassigned.items.every(ticket => ticket.assignee === null)).toBe(true)

    const byTeam = HelpdeskTicketPageSchema.parse(call('/api/v1/helpdesk/tickets?team=2'))
    expect(byTeam.total).toBe(2)
    expect(byTeam.items.every(ticket => ticket.team?.id === 2)).toBe(true)

    const byStage = HelpdeskTicketPageSchema.parse(call('/api/v1/helpdesk/tickets?stage=2'))
    expect(byStage.total).toBe(2)
    expect(byStage.items.every(ticket => ticket.stage.id === 2)).toBe(true)

    const byQuery = HelpdeskTicketPageSchema.parse(call('/api/v1/helpdesk/tickets?q=hd-0043'))
    expect(byQuery.total).toBe(1)
    expect(byQuery.items[0]?.number).toBe('HD-0043')
  })

  it('returns strict appointment types and date-anchored bookings with filters and pagination', () => {
    const types = AppointmentTypeListSchema.parse(call('/api/v1/appointments/types'))
    expect(types.total).toBe(3)
    expect(types.items).toHaveLength(3)
    expect(types.items.every(item => item.active)).toBe(true)

    const full = AppointmentBookingListSchema.parse(call('/api/v1/appointments/bookings?from=2026-11-26&to=2026-11-26'))
    expect(full.total).toBe(5)
    expect(full.items).toHaveLength(5)
    expect(full.items.map(item => item.reference)).toEqual([
      'APT-2026-0141',
      'APT-2026-0142',
      'APT-2026-0143',
      'APT-2026-0144',
      'APT-2026-0145',
    ])
    expect(full.items.some(item => item.requester_name.length >= 50)).toBe(true)
    expect(full.items.filter(item => item.start !== null).every(item => item.start?.startsWith('2026-11-26T'))).toBe(true)

    const byState = AppointmentBookingListSchema.parse(call('/api/v1/appointments/bookings?from=2026-11-26&state=scheduled'))
    expect(byState.total).toBe(2)
    expect(byState.items.every(item => item.state === 'scheduled')).toBe(true)

    const byType = AppointmentBookingListSchema.parse(call('/api/v1/appointments/bookings?from=2026-11-26&type_id=2'))
    expect(byType.total).toBe(2)
    expect(byType.items.every(item => item.type_id === 2)).toBe(true)

    const paged = AppointmentBookingListSchema.parse(call('/api/v1/appointments/bookings?from=2026-11-26&limit=1'))
    expect(paged.total).toBe(5)
    expect(paged.items).toHaveLength(1)
  })
})
