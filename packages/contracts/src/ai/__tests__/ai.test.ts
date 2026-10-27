import { AI_USAGE_BATCH_MAX, AiAuditRequestSchema, AiDraftPayloadSchema, AiEventSchema, AiModelCallEventSchema, AiModelUsageEventSchema, AiRunListQuerySchema, AiRunListSchema, AiRunPatchSchema, AiRunStatusSchema, AiStartRequestSchema, AiToolsResponseSchema, AiUsageBatchResponseSchema, AiUsageBatchSchema, AiUsageRecordSchema, AiUsageRowSchema } from '../index'

const READ = {
  name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'مهامي', en: 'My tasks' },
  input_schema: { type: 'object', properties: {} }, route: { method: 'GET', path: '/api/v1/tasks' },
  input_map: { query: { filter: 'mine' } }, result_summary: ['items[].id'], draft_target: null,
}

describe('WebVue AI contracts', () => {
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

  it('parses the run history list and rejects a row that breaks the contract', () => {
    const row = { run_id: 'r_1', title: 'وش مهامي؟', status: 'waiting_user', updated_at: '2026-10-16T10:00:00.123456Z', archived: false }
    expect(AiRunListSchema.parse({ items: [row, { ...row, run_id: 'r_2', title: null }], total: 2 }).items[1]!.title).toBeNull()
    for (const bad of [{ ...row, status: 'paused' }, { ...row, updated_at: 'yesterday' }, { ...row, extra: 1 }, { ...row, title: undefined }, { ...row, archived: undefined }, { ...row, archived: 'no' }]) {
      expect(() => AiRunListSchema.parse({ items: [bad], total: 1 })).toThrow()
    }
  })

  it('validates a run patch: a clean 1 to 80 character title and/or an archive flag, nothing else', () => {
    expect(AiRunPatchSchema.parse({ title: '  مشروع البوابة  ' })).toEqual({ title: 'مشروع البوابة' })
    expect(AiRunPatchSchema.parse({ archived: false })).toEqual({ archived: false })
    expect(AiRunPatchSchema.parse({ title: 'x'.repeat(80), archived: true }).archived).toBe(true)
    for (const bad of [{}, { title: '' }, { title: '   ' }, { title: 'x'.repeat(81) }, { title: 'a\nb' }, { title: 'a\u0000b' }, { title: 5 }, { archived: 'yes' }, { title: 'ok', extra: 1 }]) {
      expect(AiRunPatchSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('reads the archived filter of the list query', () => {
    expect(AiRunListQuerySchema.parse({}).archived).toBeUndefined()
    expect(AiRunListQuerySchema.parse({ archived: 'true', other: '1' }).archived).toBe('true')
    expect(AiRunListQuerySchema.safeParse({ archived: 'maybe' }).success).toBe(false)
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

describe('WebVue AI usage contracts', () => {
  const call = { call_id: 'ab12cd34ef56ab78', kind: 'plan', provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', called_at: '2026-10-27T10:00:00Z' }
  const usage = { call_id: 'ab12cd34ef56ab78', outcome: 'ok', input_tokens: 120, output_tokens: 7 }
  const record = { conversation_id: 'r_1', kind: 'plan', provider: 'openrouter', model: 'm', outcome: 'ok', input_tokens: 1, output_tokens: 2, called_at: '2026-10-27T10:00:00+03:00' }

  it('parses a model_call and rejects loose ids, providers, models and offsets', () => {
    expect(AiModelCallEventSchema.parse(call).kind).toBe('plan')
    for (const bad of [{ call_id: 'AB12' }, { kind: 'other' }, { provider: 'Open AI' }, { model: '' }, { model: 'a'.repeat(129) }, { model: 'a\nb' }, { called_at: '2026-10-27T10:00:00' }, { extra: 1 }]) {
      expect(() => AiModelCallEventSchema.parse({ ...call, ...bad })).toThrow()
    }
  })

  it('pairs the token counts and bounds them', () => {
    expect(AiModelUsageEventSchema.parse(usage).output_tokens).toBe(7)
    expect(AiModelUsageEventSchema.parse({ ...usage, outcome: 'aborted', input_tokens: null, output_tokens: null }).input_tokens).toBeNull()
    for (const bad of [{ output_tokens: null }, { input_tokens: null }, { input_tokens: -1 }, { input_tokens: 1.5 }, { output_tokens: 100_000_001 }, { outcome: 'lost' }]) {
      expect(() => AiModelUsageEventSchema.parse({ ...usage, ...bad })).toThrow()
    }
    expect(() => AiUsageRecordSchema.parse({ ...record, input_tokens: null })).toThrow()
  })

  it('keeps the model events out of the browser stream', () => {
    expect(() => AiEventSchema.parse({ event: 'model_call', data: call })).toThrow()
    expect(() => AiEventSchema.parse({ event: 'model_usage', data: usage })).toThrow()
  })

  it('batches 1 to 64 records and answers with the stored rows', () => {
    expect(AI_USAGE_BATCH_MAX).toBe(64)
    expect(AiUsageBatchSchema.parse({ items: [record] }).items).toHaveLength(1)
    expect(() => AiUsageBatchSchema.parse({ items: [] })).toThrow()
    expect(() => AiUsageBatchSchema.parse({ items: Array.from({ length: 65 }, () => record) })).toThrow()
    expect(AiUsageBatchSchema.parse({ items: Array.from({ length: 64 }, () => record) }).items).toHaveLength(64)
    expect(() => AiUsageRecordSchema.parse({ ...record, conversation_id: '' })).toThrow()
    expect(() => AiUsageRecordSchema.parse({ ...record, conversation_id: 'x'.repeat(65) })).toThrow()
    expect(AiUsageRowSchema.parse({ ...record, id: 5 }).id).toBe(5)
    expect(AiUsageBatchResponseSchema.parse({ items: [{ ...record, id: 5 }], total: 1 }).total).toBe(1)
  })
})
