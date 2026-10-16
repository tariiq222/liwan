import { AiAuditRequestSchema, AiDraftPayloadSchema, AiEventSchema, AiRunStatusSchema, AiStartRequestSchema, AiToolsResponseSchema } from '../index'

const READ = {
  name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'مهامي', en: 'My tasks' },
  input_schema: { type: 'object', properties: {} }, route: { method: 'GET', path: '/api/v1/tasks' },
  input_map: { query: { filter: 'mine' } }, result_summary: ['items[].id'], draft_target: null,
}

describe('Nasq AI contracts', () => {
  it('parses the tools response with limits', () => {
    const parsed = AiToolsResponseSchema.parse({ items: [READ], total: 1, limits: { tool_calls_per_run: 8, messages_monthly: null, messages_used: 2 } })
    expect(parsed.items[0]!.route?.method).toBe('GET')
    expect(parsed.limits.messages_monthly).toBeNull()
  })

  it('rejects a draft tool with a route and an unknown kind', () => {
    expect(() => AiToolsResponseSchema.parse({ items: [{ ...READ, kind: 'draft' }], total: 1, limits: { tool_calls_per_run: null, messages_monthly: null, messages_used: 0 } })).toThrow()
    expect(() => AiToolsResponseSchema.parse({ items: [{ ...READ, kind: 'delete' }], total: 1, limits: { tool_calls_per_run: null, messages_monthly: null, messages_used: 0 } })).toThrow()
  })

  it('types every SSE event by name', () => {
    expect(AiEventSchema.parse({ event: 'token', data: { text: 'م' } }).event).toBe('token')
    const request = AiEventSchema.parse({ event: 'tool_request', data: { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', input: {}, summary_ar: 'سأقرأ', summary_en: 'I will read' } })
    expect(request.event === 'tool_request' && request.data.kind).toBe('read')
    expect(() => AiEventSchema.parse({ event: 'explode', data: {} })).toThrow()
  })

  it('requires attestation to approve a draft and strips nothing silently', () => {
    expect(() => AiAuditRequestSchema.parse({ conversation_id: 'r_1', kind: 'draft', tool_name: 'pmo.draft_project', input: {}, result: 'approved', http_status: null, draft: {}, approved: {}, attested: false })).toThrow()
    expect(AiAuditRequestSchema.parse({ conversation_id: 'r_1', kind: 'message', tool_name: null, input: null, result: 'ok', http_status: null, draft: null, approved: null, attested: false }).kind).toBe('message')
  })

  it('keeps only known draft keys and needs a name', () => {
    expect(() => AiDraftPayloadSchema.parse({ name: '' })).toThrow()
    const parsed = AiDraftPayloadSchema.parse({ name: 'بوابة', charter: { objectives: ['أ'], bogus: 1 }, bogus: 2 })
    expect(parsed).toEqual({ name: 'بوابة', charter: { objectives: ['أ'] } })
  })
  it('accepts the executing run status but keeps the done event statuses unchanged', () => {
    expect(AiRunStatusSchema.parse({ run_id: 'r_1', status: 'executing', messages: [], pending: null }).status).toBe('executing')
    expect(() => AiEventSchema.parse({ event: 'done', data: { status: 'executing' } })).toThrow()
    expect(AiEventSchema.parse({ event: 'done', data: { status: 'waiting_user' } }).event).toBe('done')
  })

  it('validates the start request shape', () => {
    expect(AiStartRequestSchema.parse({ message: ' هلا ' }).message).toBe('هلا')
    expect(AiStartRequestSchema.parse({ message: 'x', run_id: 'r_1', context: { page: 'project', id: 12 } }).context).toEqual({ page: 'project', id: 12 })
    expect(AiStartRequestSchema.parse({ message: 'x', context: { page: 'home' } }).context).toEqual({ page: 'home' })
    expect(AiStartRequestSchema.parse({ message: 'x', context: null, run_id: null }).context).toBeNull()
    for (const bad of [
      { message: 5 }, { message: '  ' }, { message: 'x'.repeat(8001) }, { message: 'x', run_id: 7 }, { message: 'x', run_id: '' },
      { message: 'x', context: 'project' }, { message: 'x', context: { page: 3 } }, { message: 'x', context: { page: 'a/b' } },
      { message: 'x', context: { page: 'project', id: '12' } }, { message: 'x', context: { page: 'project', id: 1.5 } }, { message: 'x', context: { page: 'p', extra: 1 } },
      'text', null, [],
    ]) expect(AiStartRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
  })
})
