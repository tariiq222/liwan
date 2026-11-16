import { describe, expect, it } from 'vitest'
import { HelpdeskResourcesSchema, HelpdeskTeamSaveSchema } from '..'
import { HelpdeskSettingsSchema } from '../settings'
import { HelpdeskTicketPageSchema, HelpdeskTicketSchema, HelpdeskTicketCreateSchema } from '..'

const row = {
  id: 1,
  number: 'HD00001',
  subject: 'Printer is down',
  team: { id: 2, name: 'Support' },
  stage: { id: 3, name: 'New', closed: false },
  priority: 'high' as const,
  assignee: null,
  requester: { kind: 'customer' as const, id: 4, name: 'Acme' },
  category: null,
  type: null,
  channel: null,
  tags: [],
  sla: { state: 'none' as const, deadline: null, rows: [] },
  created_at: '2026-11-16T08:00:00Z',
  last_activity_at: '2026-11-16T09:00:00Z',
}

describe('helpdesk contracts', () => {
  it('accepts a list page of tickets', () => {
    expect(HelpdeskTicketPageSchema.parse({ items: [row], total: 1 }).total).toBe(1)
  })

  it('refuses an unknown priority and an unknown field', () => {
    expect(HelpdeskTicketPageSchema.safeParse({ items: [{ ...row, priority: 'whenever' }], total: 1 }).success).toBe(false)
    expect(HelpdeskTicketPageSchema.safeParse({ items: [{ ...row, extra: 1 }], total: 1 }).success).toBe(false)
  })

  it('carries the description, thread links and first response of one ticket', () => {
    const ticket = {
      ...row,
      description: '<p>It does not print.</p>',
      related: [],
      first_response: { at: null, due: '2026-11-16T16:00:00Z' },
      assigned_at: null,
      closed_at: null,
      attachments: [],
    }
    expect(HelpdeskTicketSchema.parse(ticket).first_response.due).toBe('2026-11-16T16:00:00Z')
  })

  it('requires a subject and a description to open a ticket', () => {
    expect(HelpdeskTicketCreateSchema.safeParse({ subject: 'A', description: 'B' }).success).toBe(true)
    expect(HelpdeskTicketCreateSchema.safeParse({ description: 'B' }).success).toBe(false)
    expect(HelpdeskTicketCreateSchema.safeParse({ subject: 'A' }).success).toBe(false)
  })

  it('reads the settings the screen edits', () => {
    const settings = {
      revision: 0,
      preset: 'general',
      visibility: 'team',
      default_team_id: 2,
      default_priority: '1',
      reference_prefix: 'HD',
      reopen_days: 7,
      first_response_hours: 8,
      resolution_hours: 72,
      options: {
        presets: [{ value: 'general', label: 'General' }],
        visibility: [{ value: 'team', label: 'My teams' }],
        priorities: [{ value: '1', label: 'Medium' }],
        priority_names: { '1': 'medium' },
        ranges: { reopen_days: [0, 90] },
      },
    }
    expect(HelpdeskSettingsSchema.parse(settings).visibility).toBe('team')
    expect(HelpdeskSettingsSchema.safeParse({ ...settings, visibility: 'everyone' }).success).toBe(false)
  })

  it('reads the settings resources and validates a team save', () => {
    const stage = { id: 1, name: 'New', active: true, sequence: 1, closed: false, unattended: false, fold: false, team_ids: [], shared: false }
    const named = { id: 2, name: 'Network', active: true, sequence: 10 }
    const body = {
      teams: [{ id: 3, name: 'Support', active: true, sequence: 10, member_ids: [], leader_id: null, calendar_id: null }],
      stages: [stage],
      categories: [{ ...named, parent_id: null }],
      tags: [named], channels: [named], types: [named],
    }
    expect(HelpdeskResourcesSchema.parse(body).teams[0].name).toBe('Support')
    expect(HelpdeskTeamSaveSchema.safeParse({ name: 'Line 2', member_ids: [1, 2], leader_id: 1 }).success).toBe(true)
    expect(HelpdeskTeamSaveSchema.safeParse({ name: '' }).success).toBe(false)
    expect(HelpdeskTeamSaveSchema.safeParse({ name: 'Line 2', unknown: true }).success).toBe(false)
  })
})
