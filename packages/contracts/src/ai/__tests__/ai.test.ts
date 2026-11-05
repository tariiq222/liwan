import { AI_USAGE_BATCH_MAX, AiAgentPatchSchema, AiAgentSettingsSchema, aiToolAgent, AiAuditRequestSchema, AiKeyPutSchema, AiMonitoringSchema, AiRetentionPutSchema, AiSettingsPatchSchema, AiSettingsSchema, AiTenantConfigSchema, AiDraftPayloadSchema, AiEventSchema, AiModelCallEventSchema, AiModelUsageEventSchema, AiRunListQuerySchema, AiRunListSchema, AiRunPatchSchema, AiRunStatusSchema, AiStartRequestSchema, AiToolsResponseSchema, AiUsageBatchResponseSchema, AiUsageBatchSchema, AiUsageRecordSchema, AiUsageRowSchema } from '../index'

const READ = {
  name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'مهامي', en: 'My tasks' },
  input_schema: { type: 'object', properties: {} }, route: { method: 'GET', path: '/api/v1/tasks' },
  input_map: { query: { filter: 'mine' } }, result_summary: ['items[].id'], draft_target: null, requires_approval: false,
}
const PMO_AGENT = { key: 'pmo', name: { ar: 'وكيل المشاريع', en: 'Projects agent' }, description: { ar: 'المشاريع', en: 'Projects' }, instructions: { ar: 'أنت وكيل المشاريع', en: 'You are the projects agent' }, pages: ['pmo', 'project'] }

describe('LiwanOS AI contracts', () => {
  it('parses the tools response with limits', () => {
    const parsed = AiToolsResponseSchema.parse({ items: [READ], total: 1, agents: [PMO_AGENT], limits: { tool_calls_per_run: 8, messages_monthly: null, messages_used: 2, policy: { provider_mode: 'platform', outside_allowed: false, tokens_monthly: null, tokens_used: 0, output_tokens_per_run: null } } })
    expect(parsed.items[0]!.route?.method).toBe('GET')
    expect(parsed.limits.messages_monthly).toBeNull()
  })

  it('rejects a draft tool with a route and an unknown kind', () => {
    expect(() => AiToolsResponseSchema.parse({ items: [{ ...READ, kind: 'draft' }], total: 1, agents: [], limits: { tool_calls_per_run: null, messages_monthly: null, messages_used: 0, policy: { provider_mode: 'platform', outside_allowed: false, tokens_monthly: null, tokens_used: 0, output_tokens_per_run: null } } })).toThrow()
    expect(() => AiToolsResponseSchema.parse({ items: [{ ...READ, kind: 'delete' }], total: 1, agents: [], limits: { tool_calls_per_run: null, messages_monthly: null, messages_used: 0, policy: { provider_mode: 'platform', outside_allowed: false, tokens_monthly: null, tokens_used: 0, output_tokens_per_run: null } } })).toThrow()
  })

  it('types every SSE event by name', () => {
    expect(AiEventSchema.parse({ event: 'token', data: { text: 'م' } }).event).toBe('token')
    const request = AiEventSchema.parse({ event: 'tool_request', data: { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', agent: 'pmo', requires_approval: false, input: {}, summary_ar: 'سأقرأ', summary_en: 'I will read' } })
    expect(request.event === 'tool_request' && request.data.kind).toBe('read')
    expect(AiEventSchema.parse({ event: 'agent', data: { agent: 'hr', name: { ar: 'وكيل الموارد البشرية', en: 'HR agent' } } }).event).toBe('agent')
    expect(() => AiEventSchema.parse({ event: 'agent', data: { agent: 'Not A Key', name: { ar: 'س', en: 'x' } } })).toThrow()
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

describe('LiwanOS AI usage contracts', () => {
  const call = { call_id: 'ab12cd34ef56ab78', kind: 'plan', billing: 'platform', provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', called_at: '2026-10-27T10:00:00Z' }
  const usage = { call_id: 'ab12cd34ef56ab78', outcome: 'ok', input_tokens: 120, output_tokens: 7 }
  const record = { conversation_id: 'r_1', kind: 'plan', billing: 'platform', provider: 'openrouter', model: 'm', outcome: 'ok', input_tokens: 1, output_tokens: 2, called_at: '2026-10-27T10:00:00+03:00' }

  it('parses a model_call and rejects loose ids, providers, models and offsets', () => {
    expect(AiModelCallEventSchema.parse(call).kind).toBe('plan')
    for (const bad of [{ call_id: 'AB12' }, { kind: 'other' }, { provider: 'Open AI' }, { model: '' }, { model: 'a'.repeat(129) }, { model: 'a\nb' }, { model: 'a\u0085b' }, { model: 'a\u009fb' }, { model: 'a\u007fb' }, { called_at: '2026-10-27T10:00:00' }, { extra: 1 }]) {
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

  it('parses the AI settings with the consent text and the month usage', () => {
    const settings = {
      provider_mode: 'platform', messages_per_user_monthly: 0, external_send: 'draft_only', revision: 1,
      consent: { required_version: '2026-11-05-draft', text_ar: 'نص', text_en: 'text', text_hash: 'a'.repeat(64), signed: null },
      usage: { month: '2026-11', messages_used: 3, messages_limit: null, tokens_used: 120, tokens_limit: 2000000, output_tokens_per_run: 8000 },
    }
    expect(AiSettingsSchema.parse(settings).usage.tokens_limit).toBe(2000000)
    expect(() => AiSettingsSchema.parse({ ...settings, provider_mode: 'free' })).toThrow()
    expect(() => AiSettingsPatchSchema.parse({ provider_mode: 'tenant_key', revision: 0 })).toThrow()
  })

  it('keeps the tenant key write-only and the retention bounded', () => {
    const config = {
      retention_days: 30, key: { configured: true, provider: 'anthropic', model: 'claude-test', last4: 'abcd', updated_at: '2026-11-05T10:00:00Z' },
      platform: { provider: 'ollama', model: 'm', location: 'inside' }, providers: [{ name: 'anthropic', location: 'outside', needs_api_key: true }],
    }
    expect(AiTenantConfigSchema.parse(config).key.last4).toBe('abcd')
    expect(() => AiTenantConfigSchema.parse({ ...config, key: { ...config.key, api_key: 'sk' } })).toThrow()
    expect(() => AiRetentionPutSchema.parse({ retention_days: 366 })).toThrow()
    expect(() => AiKeyPutSchema.parse({ provider: 'anthropic', model: 'm', api_key: '' })).toThrow()
  })

  it('counts monitoring actions without any message text', () => {
    const body = {
      month: '2026-11', totals: { messages: 2, input_tokens: 30, output_tokens: 0, tool_calls: 0 },
      users: { items: [{ user: { id: 7, name: 'هدى' }, messages: 2, tokens: 30, tool_calls: 0 }], total: 1 }, tools: { items: [], total: 0 }, agents: { items: [{ agent: 'pmo', calls: 3 }], total: 1 },
    }
    expect(AiMonitoringSchema.parse(body).users.total).toBe(1)
    expect(() => AiMonitoringSchema.parse({ ...body, users: { ...body.users, items: [{ ...body.users.items[0], text: 'سؤال' }] } })).toThrow()
  })

  it('parses the agent settings and refuses an empty or widening patch', () => {
    const tool = { name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'مهامي', en: 'My tasks' }, external: false, mode: 'approval' }
    const parsed = AiAgentSettingsSchema.parse({ items: [{ key: 'pmo', name: PMO_AGENT.name, description: PMO_AGENT.description, enabled: true, read_only: false, role_ids: [], tools: [tool] }], total: 1 })
    expect(parsed.items[0]!.tools[0]!.mode).toBe('approval')
    expect(() => AiAgentPatchSchema.parse({})).toThrow()
    expect(() => AiAgentPatchSchema.parse({ tools: { 'pmo.list_my_tasks': 'always' } })).toThrow()
    expect(AiAgentPatchSchema.parse({ read_only: true }).read_only).toBe(true)
    expect(aiToolAgent('pmo.list_my_tasks')).toBe('pmo')
  })
})
