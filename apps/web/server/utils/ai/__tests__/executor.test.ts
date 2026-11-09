import { describe, expect, it } from 'vitest'
import type { AiTool } from '@liwan/contracts'
import { buildToolRequest, summarizeResult, toolCallBudget, toolResultFromUpstream } from '../executor'
import { restoreValue, tokenKeyFrom } from '../outbound'

const list: AiTool = {
  name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'م', en: 'm' }, input_schema: { type: 'object' },
  route: { method: 'GET', path: '/api/v1/tasks' }, input_map: { query: { filter: 'mine', state: '$state', limit: '$limit' } },
  result_summary: ['items[].id', 'items[].name', 'items[].project.name', 'total'], draft_target: null, draft_model: null, requires_approval: false, platform: false,
}
const transition: AiTool = {
  ...list, name: 'pmo.update_task_state', kind: 'write_light', route: { method: 'POST', path: '/api/v1/tasks/{task_id}/transition' },
  input_map: { path: { task_id: '$task_id' }, body: { state: '$state' } }, result_summary: ['id', 'state'],
}

describe('buildToolRequest', () => {
  it('maps inputs onto query, drops missing ones and keeps constants', () => {
    expect(buildToolRequest(list, { limit: 5 })).toEqual({ method: 'GET', path: '/api/v1/tasks', query: { filter: 'mine', limit: 5 }, body: undefined })
  })
  it('fills path placeholders and the body', () => {
    expect(buildToolRequest(transition, { task_id: 7, state: 'done' })).toEqual({ method: 'POST', path: '/api/v1/tasks/7/transition', query: {}, body: { state: 'done' } })
  })
  it('refuses an unfilled placeholder', () => {
    expect(() => buildToolRequest(transition, { state: 'done' })).toThrow(/task_id/)
  })
  it('refuses path values that could escape the segment', () => {
    expect(() => buildToolRequest(transition, { task_id: '7/../8', state: 'done' })).toThrow(/invalid path value/)
  })
})

const search: AiTool = {
  ...list, name: 'ai.search_knowledge', route: { method: 'POST', path: '/api/v1/ai/knowledge/resolve' },
  input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  input_map: { body: { refs: '$refs' } }, result_summary: ['items[]'],
}

describe('knowledge search tool', () => {
  const refs = [{ model: 'crm.lead', res_id: 4, chunk_no: 0 }, { model: 'project.task', res_id: 9, chunk_no: 2 }]
  it('posts the refs the service added to the input', () => {
    expect(buildToolRequest(search, { query: 'عقد', refs })).toEqual({ method: 'POST', path: '/api/v1/ai/knowledge/resolve', query: {}, body: { refs } })
  })
  it('protects a phone number inside an item text', () => {
    const body = { items: [{ model: 'crm.lead', res_id: 4, chunk_no: 0, title: 'عميل', source: 'CRM', text: 'اتصل على 0551234567 غدًا' }], total: 1 }
    const result = toolResultFromUpstream(200, body, search, NONE, KEY)
    expect(result).toMatchObject({ ok: true, data: { items: [{ title: 'عميل', text: expect.stringMatching(/^اتصل على \[phone:[A-Za-z0-9_-]+\] غدًا$/) }] } })
  })
})

describe('buildToolRequest path safety', () => {
  it.each([[''], ['.'], ['..'], ['a\0b']])('refuses the path value %j', (value) => {
    expect(() => buildToolRequest(transition, { task_id: value, state: 'done' })).toThrow(/invalid path value/)
  })
  it.each([['%2e%2e'], ['7/8'], ['a b'], ['7?x=1'], ['7#'], ['é']])('refuses the encoded or special path value %j', (value) => {
    expect(() => buildToolRequest(transition, { task_id: value, state: 'done' })).toThrow(/invalid path value/)
  })
  it('accepts numbers and simple slugs', () => {
    expect(buildToolRequest(transition, { task_id: 7, state: 'done' }).path).toBe('/api/v1/tasks/7/transition')
    expect(buildToolRequest(transition, { task_id: 'task_7-a.b~c', state: 'done' }).path).toBe('/api/v1/tasks/task_7-a.b~c/transition')
  })
  it('refuses a path that does not survive URL normalization unchanged', () => {
    const odd: AiTool = { ...transition, route: { method: 'POST', path: '/api/v1/tasks/{task_id}/../x' } }
    expect(() => buildToolRequest(odd, { task_id: 7, state: 'done' })).toThrow(/invalid path/)
  })
})

const NONE: ReadonlySet<string> = new Set()
const KEY = tokenKeyFrom('test-secret-of-at-least-32-characters', { tenant: 't', user: '1' })

describe('summarizeResult', () => {
  it('strips blocked fields at any depth, even under a path that ends on a whole object', () => {
    const data = { items: [{ id: 1, employee: { name: 'أحمد', wage: 9000, contact: { mobile: '0551234567', city: 'جدة' } } }], total: 1 }
    expect(summarizeResult(data, ['items[].id', 'items[].employee'], new Set(['wage', 'mobile']))).toEqual({
      items: [{ id: 1, employee: { name: 'أحمد', contact: { city: 'جدة' } } }],
    })
  })

  it('keeps only whitelisted paths, including nested arrays', () => {
    const data = { items: [{ id: 1, name: 'أ', secret: 'x', project: { id: 9, name: 'ب', budget: 3 } }], total: 1, extra: true }
    expect(summarizeResult(data, list.result_summary, NONE)).toEqual({ items: [{ id: 1, name: 'أ', project: { name: 'ب' } }], total: 1 })
  })
  it('returns an empty object when nothing matches', () => {
    expect(summarizeResult({ a: 1 }, ['b'], NONE)).toEqual({})
  })
})

describe('toolResultFromUpstream', () => {
  it('withholds sensitive values before the size check', () => {
    const protectedResult = toolResultFromUpstream(200, { items: [{ id: 1, name: 'جوال 0551234567' }], total: 1 }, list, NONE, KEY)
    expect(JSON.stringify(protectedResult)).not.toContain('0551234567')
    expect(restoreValue(protectedResult, KEY)).toEqual({ ok: true, data: { items: [{ id: 1, name: 'جوال 0551234567' }], total: 1 } })
    // The tool ran with the real value, so an error that echoes it is protected like data.
    const refused = toolResultFromUpstream(422, { code: 'invalid', message: 'الجوال 0551234567 مستخدم' }, list, NONE, KEY)
    expect(JSON.stringify(refused)).not.toContain('0551234567')
    expect(restoreValue(refused, KEY)).toEqual({ ok: false, error: { code: 'invalid', message: 'الجوال 0551234567 مستخدم' } })
    // A message near the limit stays within it once its value becomes a token, and no token is cut.
    const long = toolResultFromUpstream(422, { code: 'invalid', message: `${'x'.repeat(1989)} 0551234567` }, list, NONE, KEY)
    expect(long.ok ? '' : long.error.message.length).toBeLessThanOrEqual(2000)
    expect(JSON.stringify(long)).not.toContain('0551234567')
    // Many short emails grow past the bound once each becomes a marker: the result is refused, never sent oversized.
    const emails = Array.from({ length: 14_000 }, (_, index) => `a${index}@b.sa`).join(' ')
    expect(toolResultFromUpstream(200, { items: [{ id: 1, name: emails }], total: 1 }, list, NONE, KEY)).toMatchObject({ ok: false, error: { code: 'result_too_large' } })
  })

  it('wraps 2xx as ok with the summarized data', () => {
    expect(toolResultFromUpstream(200, { items: [{ id: 1, name: 'أ', secret: 1 }], total: 1 }, list, NONE, KEY)).toEqual({ ok: true, data: { items: [{ id: 1, name: 'أ' }], total: 1 } })
  })
  it('wraps a flat Odoo error body as a tool error', () => {
    expect(toolResultFromUpstream(403, { code: 'forbidden', message: 'no' }, list, NONE, KEY)).toEqual({ ok: false, error: { code: 'forbidden', message: 'no' } })
  })
  it('still reads a nested error body as a fallback', () => {
    expect(toolResultFromUpstream(403, { error: { code: 'forbidden', message: 'no' } }, list, NONE, KEY)).toEqual({ ok: false, error: { code: 'forbidden', message: 'no' } })
  })
  it('wraps an unknown failure as http_error', () => {
    expect(toolResultFromUpstream(502, 'bad gateway', list, NONE, KEY)).toEqual({ ok: false, error: { code: 'http_error', message: 'upstream status 502' } })
  })
  it('refuses a summarized result over 200 000 bytes with a fixed error', () => {
    const big = { items: Array.from({ length: 5000 }, (_, id) => ({ id, name: 'م'.repeat(30) })), total: 5000 }
    const result = toolResultFromUpstream(200, big, list, NONE, KEY)
    expect(result).toEqual({ ok: false, error: { code: 'result_too_large', message: expect.any(String) } })
    expect(JSON.stringify(result)).not.toContain('مممم')
  })
  it('keeps a result just under the cap', () => {
    expect(toolResultFromUpstream(200, { items: [{ id: 1, name: 'x'.repeat(190_000) }], total: 1 }, list, NONE, KEY).ok).toBe(true)
  })
  it('truncates an upstream error code to 60 and its message to 2000 characters', () => {
    const result = toolResultFromUpstream(422, { code: 'c'.repeat(200), message: 'm'.repeat(5000) }, list, NONE, KEY)
    expect(result).toEqual({ ok: false, error: { code: 'c'.repeat(60), message: 'm'.repeat(2000) } })
  })
})

describe('toolCallBudget', () => {
  it('defaults when the operator set nothing and clamps to what the service accepts', () => {
    expect(toolCallBudget(null)).toBe(8)
    expect(toolCallBudget(5)).toBe(5)
    expect(toolCallBudget(0)).toBe(0)
    expect(toolCallBudget(1000)).toBe(50)
  })
})
