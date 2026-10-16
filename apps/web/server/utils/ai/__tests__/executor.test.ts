import { describe, expect, it } from 'vitest'
import type { AiTool } from '@nasq/contracts'
import { buildToolRequest, summarizeResult, toolCallBudget, toolResultFromUpstream } from '../executor'

const list: AiTool = {
  name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'م', en: 'm' }, input_schema: { type: 'object' },
  route: { method: 'GET', path: '/api/v1/tasks' }, input_map: { query: { filter: 'mine', state: '$state', limit: '$limit' } },
  result_summary: ['items[].id', 'items[].name', 'items[].project.name', 'total'], draft_target: null,
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

describe('summarizeResult', () => {
  it('keeps only whitelisted paths, including nested arrays', () => {
    const data = { items: [{ id: 1, name: 'أ', secret: 'x', project: { id: 9, name: 'ب', budget: 3 } }], total: 1, extra: true }
    expect(summarizeResult(data, list.result_summary)).toEqual({ items: [{ id: 1, name: 'أ', project: { name: 'ب' } }], total: 1 })
  })
  it('returns an empty object when nothing matches', () => {
    expect(summarizeResult({ a: 1 }, ['b'])).toEqual({})
  })
})

describe('toolResultFromUpstream', () => {
  it('wraps 2xx as ok with the summarized data', () => {
    expect(toolResultFromUpstream(200, { items: [{ id: 1, name: 'أ', secret: 1 }], total: 1 }, list)).toEqual({ ok: true, data: { items: [{ id: 1, name: 'أ' }], total: 1 } })
  })
  it('wraps a flat Odoo error body as a tool error', () => {
    expect(toolResultFromUpstream(403, { code: 'forbidden', message: 'no' }, list)).toEqual({ ok: false, error: { code: 'forbidden', message: 'no' } })
  })
  it('still reads a nested error body as a fallback', () => {
    expect(toolResultFromUpstream(403, { error: { code: 'forbidden', message: 'no' } }, list)).toEqual({ ok: false, error: { code: 'forbidden', message: 'no' } })
  })
  it('wraps an unknown failure as http_error', () => {
    expect(toolResultFromUpstream(502, 'bad gateway', list)).toEqual({ ok: false, error: { code: 'http_error', message: 'upstream status 502' } })
  })
  it('refuses a summarized result over 200 000 bytes with a fixed error', () => {
    const big = { items: Array.from({ length: 5000 }, (_, id) => ({ id, name: 'م'.repeat(30) })), total: 5000 }
    const result = toolResultFromUpstream(200, big, list)
    expect(result).toEqual({ ok: false, error: { code: 'result_too_large', message: expect.any(String) } })
    expect(JSON.stringify(result)).not.toContain('مممم')
  })
  it('keeps a result just under the cap', () => {
    expect(toolResultFromUpstream(200, { items: [{ id: 1, name: 'x'.repeat(190_000) }], total: 1 }, list).ok).toBe(true)
  })
  it('truncates an upstream error code to 60 and its message to 2000 characters', () => {
    const result = toolResultFromUpstream(422, { code: 'c'.repeat(200), message: 'm'.repeat(5000) }, list)
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
