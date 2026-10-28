import { beforeEach, describe, expect, it } from 'vitest'
import {
  InboxCannedReplyListSchema, InboxChannelListSchema, InboxChannelSchema, InboxConversationDetailSchema, InboxConversationListSchema,
  InboxDepartmentListSchema, InboxMessageListSchema, InboxMessageSchema, InboxSettingsSchema, InboxTagListSchema, InboxTemplateListSchema,
} from '@webvue/contracts'
import { inboxPreviewData, resetInboxPreview } from '../../../../e2e/inbox-ui-preview-data.mjs'

const call = (method: string, target: string, body: object = {}) => {
  const url = new URL(target, 'http://localhost')
  return inboxPreviewData(method, url.pathname, url, body) as { status: number; body: unknown }
}

// The audit mock serves the inbox pages; every shape it answers must be one the contract accepts.
describe('inbox audit mock', () => {
  beforeEach(() => resetInboxPreview())

  it('serves contract-valid lists and details', () => {
    expect(InboxConversationListSchema.parse(call('GET', '/api/v1/inbox/conversations').body).total).toBe(4)
    expect(InboxConversationDetailSchema.parse(call('GET', '/api/v1/inbox/conversations/1').body).can_reply).toBe(true)
    expect(InboxMessageListSchema.parse(call('GET', '/api/v1/inbox/conversations/1/messages').body).items.length).toBeGreaterThan(0)
    expect(InboxCannedReplyListSchema.parse(call('GET', '/api/v1/inbox/canned-replies').body).total).toBe(2)
    expect(InboxTemplateListSchema.parse(call('GET', '/api/v1/inbox/channels/1/templates').body).total).toBe(2)
    expect(InboxTagListSchema.parse(call('GET', '/api/v1/inbox/tags').body).total).toBe(3)
    expect(InboxDepartmentListSchema.parse(call('GET', '/api/v1/inbox/departments').body).total).toBe(2)
    expect(InboxSettingsSchema.parse(call('GET', '/api/v1/settings/inbox').body).visibility_policy).toBe('department')
    expect(InboxChannelListSchema.parse(call('GET', '/api/v1/inbox/channels').body).total).toBe(1)
  })

  it('filters the list like the server', () => {
    const ids = (query: string) => (call('GET', `/api/v1/inbox/conversations?${query}`).body as { items: { id: number }[] }).items.map(item => item.id)
    expect(ids('assignee=me')).toEqual([1])
    expect(ids('assignee=unassigned')).toEqual(expect.arrayContaining([2, 4]))
    expect(ids('state=resolved')).toEqual([3])
    expect(ids('q=فهد')).toEqual([2])
  })

  it('refuses free text after the window and accepts an approved template', () => {
    expect(call('POST', '/api/v1/inbox/conversations/2/messages', { body: 'مرحبا' }).status).toBe(422)
    expect(call('POST', '/api/v1/inbox/conversations/2/messages', { template_id: 1, params: ['فهد'] }).status).toBe(422)
    const sent = call('POST', '/api/v1/inbox/conversations/2/messages', { template_id: 1, params: ['فهد', 'الخميس'] })
    expect(InboxMessageSchema.parse(sent.body).delivery_state).toBe('queued')
    expect(call('POST', '/api/v1/inbox/conversations/1/messages', { body: 'مرحبا' }).status).toBe(200)
  })

  it('pages messages from the newest, ascending inside a page, like the server', () => {
    const ids = (query: string) => (call('GET', `/api/v1/inbox/conversations/1/messages?${query}`).body as { items: { id: number }[]; total: number })
    const newest = ids('limit=3&offset=0')
    const older = ids('limit=3&offset=3')
    expect(newest.total).toBe(4)
    expect(newest.items).toHaveLength(3)
    expect(older.items).toHaveLength(1)
    expect(older.items[0]!.id).toBeLessThan(newest.items[0]!.id)
  })

  it('retries only a failed message', () => {
    const failed = (call('GET', '/api/v1/inbox/conversations/2/messages').body as { items: { id: number; delivery_state: string }[] }).items.find(item => item.delivery_state === 'failed')!
    expect(InboxMessageSchema.parse(call('POST', `/api/v1/inbox/messages/${failed.id}/retry`).body).delivery_state).toBe('queued')
    expect(call('POST', `/api/v1/inbox/messages/${failed.id}/retry`).status).toBe(422)
  })

  it('creates a channel without ever echoing a secret', () => {
    const created = call('POST', '/api/v1/inbox/channels', { name: 'جديدة', kind: 'whatsapp', phone_number_id: '12345678', business_account_id: '87654321', access_token: 'x'.repeat(20), app_secret: 'y'.repeat(20) })
    const channel = InboxChannelSchema.parse(created.body)
    expect(channel.has_access_token).toBe(true)
    expect(JSON.stringify(created.body)).not.toContain('xxxxx')
  })

  it('applies a preset idempotently', () => {
    call('POST', '/api/v1/settings/inbox/presets/clinic')
    const once = (call('GET', '/api/v1/inbox/tags').body as { total: number }).total
    call('POST', '/api/v1/settings/inbox/presets/clinic')
    expect((call('GET', '/api/v1/inbox/tags').body as { total: number }).total).toBe(once)
    expect(call('POST', '/api/v1/settings/inbox/presets/unknown').status).toBe(404)
  })

  it('refuses an assignee who is not an agent', () => {
    expect(call('PATCH', '/api/v1/inbox/conversations/4', { assignee_id: 999 }).status).toBe(422)
    expect(InboxConversationDetailSchema.parse(call('PATCH', '/api/v1/inbox/conversations/4', { assignee_id: 5, state: 'pending', tag_ids: [1, 2] }).body).tags).toHaveLength(2)
  })
})
