import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { applyEvent, parseSseChunk, useAiRun, type AiThreadItem } from '../useAiRun'

describe('parseSseChunk', () => {
  it('splits complete blocks and keeps the remainder', () => {
    const { events, rest } = parseSseChunk('event: run\ndata: {"run_id":"r_1"}\n\nevent: token\ndata: {"text":"م')
    expect(events).toEqual([{ event: 'run', data: { run_id: 'r_1' } }])
    expect(rest).toBe('event: token\ndata: {"text":"م')
  })
})

describe('applyEvent', () => {
  const start = (): AiThreadItem[] => [{ kind: 'user', text: 'هلا' }]
  it('accumulates tokens into one assistant item and finalizes on answer', () => {
    let items = start()
    items = applyEvent(items, { event: 'token', data: { text: 'عن' } })
    items = applyEvent(items, { event: 'token', data: { text: 'دك' } })
    items = applyEvent(items, { event: 'answer', data: { text: 'عندك مهمة', records: [{ type: 'task', id: 5, label: 'تقرير' }] } })
    expect(items.at(-1)).toEqual({ kind: 'assistant', text: 'عندك مهمة', records: [{ type: 'task', id: 5, label: 'تقرير' }], streaming: false })
  })
  it('records read tools as traces and write/draft requests as pending cards', () => {
    let items = start()
    items = applyEvent(items, { event: 'tool_request', data: { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', input: {}, summary_ar: 'سأقرأ مهامك', summary_en: 'read' } })
    items = applyEvent(items, { event: 'tool_result', data: { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', ok: false, summary_ar: 'سأقرأ مهامك', summary_en: 'read' } })
    expect(items.at(-1)).toEqual({ kind: 'tool', callId: 'c_1', summaryAr: 'سأقرأ مهامك', summaryEn: 'read', state: 'denied' })
    items = applyEvent(items, { event: 'tool_request', data: { call_id: 'c_2', tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة' }, summary_ar: 'سأجهّز', summary_en: 'draft' } })
    expect(items.at(-1)).toMatchObject({ kind: 'draft', callId: 'c_2', tool: 'pmo.draft_project', payload: { name: 'بوابة' }, state: 'pending' })
  })
  it('marks a pending card decided', () => {
    let items = start()
    items = applyEvent(items, { event: 'tool_request', data: { call_id: 'c_3', tool: 'pmo.update_task_state', kind: 'write_light', input: { task_id: 7, state: 'done' }, summary_ar: 'سأغيّر', summary_en: 'change' } })
    items = applyEvent(items, { event: 'decided', data: { call_id: 'c_3', decision: 'approved' } })
    expect(items.at(-1)).toMatchObject({ kind: 'confirm', state: 'approved' })
  })
  it('turns a stalled read back to running on retry and to stalled when the retry never reached the server', () => {
    let items: AiThreadItem[] = [{ kind: 'tool', callId: 'c_5', summaryAr: 'أ', summaryEn: 'a', state: 'stalled' }]
    items = applyEvent(items, { event: 'decided', data: { call_id: 'c_5', decision: 'approved' } })
    expect(items[0]).toMatchObject({ kind: 'tool', state: 'running' })
    items = applyEvent(items, { event: 'decided', data: { call_id: 'c_5', decision: 'pending' } })
    expect(items[0]).toMatchObject({ kind: 'tool', state: 'stalled' })
  })
  it('marks a successful read as ok', () => {
    let items = start()
    items = applyEvent(items, { event: 'tool_request', data: { call_id: 'c_4', tool: 'pmo.list_my_tasks', kind: 'read', input: {}, summary_ar: 'أ', summary_en: 'a' } })
    items = applyEvent(items, { event: 'tool_result', data: { call_id: 'c_4', tool: 'pmo.list_my_tasks', kind: 'read', ok: true, summary_ar: 'أ', summary_en: 'a' } })
    expect(items.at(-1)).toMatchObject({ kind: 'tool', state: 'ok' })
  })
})

const sse = (...blocks: Array<[string, unknown]>) => blocks.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
const streamResponse = (body: string) => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('useAiRun', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('streams a run: run id, tokens, answer and done', async () => {
    fetchMock.mockResolvedValue(streamResponse(sse(
      ['run', { run_id: 'r_1' }], ['token', { text: 'مرحبا' }],
      ['answer', { text: 'مرحبا بك', records: [] }], ['done', { status: 'done' }],
    )))
    const ai = useAiRun()
    await ai.send('هلا', { page: 'project', id: 12 })
    expect(ai.runId.value).toBe('r_1')
    expect(ai.status.value).toBe('done')
    expect(ai.items.value).toEqual([{ kind: 'user', text: 'هلا' }, { kind: 'assistant', text: 'مرحبا بك', records: [], streaming: false }])
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ message: 'هلا', context: { page: 'project', id: 12 } })
  })

  it('keeps streaming on waiting_tool and moves to waiting_user on a pending card', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(sse(['run', { run_id: 'r_1' }], ['done', { status: 'waiting_tool' }])))
    const ai = useAiRun()
    await ai.send('أنشئ')
    expect(ai.status.value).toBe('streaming')
    fetchMock.mockResolvedValueOnce(streamResponse(sse(['done', { status: 'waiting_user' }])))
    await ai.send('أكمل')
    expect(ai.status.value).toBe('waiting_user')
  })

  it('shows the limit event without a raw message', async () => {
    fetchMock.mockResolvedValue(streamResponse(sse(['run', { run_id: 'r_1' }], ['limit_reached', { limit: 'max_steps' }], ['done', { status: 'limit_reached' }])))
    const ai = useAiRun()
    await ai.send('س')
    expect(ai.limit.value).toBe('max_steps')
    expect(ai.status.value).toBe('limit_reached')
  })

  it('maps an error event to a fixed message, never the raw text', async () => {
    fetchMock.mockResolvedValue(streamResponse(sse(['error', { code: 'provider_unavailable', message: 'sk-secret upstream stack trace' }], ['done', { status: 'failed' }])))
    const ai = useAiRun()
    await ai.send('س')
    expect(ai.error.value).toBe('ai.errors.provider')
    fetchMock.mockResolvedValue(streamResponse(sse(['error', { code: 'weird', message: 'raw detail' }], ['done', { status: 'failed' }])))
    await ai.send('س')
    expect(ai.error.value).toBe('errors.generic')
    expect(ai.status.value).toBe('failed')
  })

  it('treats the monthly limit 403 as a limit state, not an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { data: { code: 'feature_not_included', details: { limit_key: 'ai.messages.monthly' } } }))
    const ai = useAiRun()
    await ai.send('س')
    expect(ai.limit.value).toBe('messages_monthly')
    expect(ai.status.value).toBe('limit_reached')
    expect(ai.error.value).toBeNull()
  })

  it('treats 503 ai_unavailable as the unavailable state', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { data: { code: 'ai_unavailable' } }))
    const ai = useAiRun()
    await ai.send('س')
    expect(ai.unavailable.value).toBe(true)
    expect(ai.error.value).toBeNull()
  })

  it('reports a generic error for any other failed response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { data: { code: 'boom' } }))
    const ai = useAiRun()
    await ai.send('س')
    expect(ai.error.value).toBe('errors.generic')
    expect(ai.status.value).toBe('failed')
  })

  it('load() rebuilds messages and a pending card whose summary falls back to the tool name', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      run_id: 'r_9', status: 'waiting_user',
      messages: [{ role: 'user', content: 'أنشئ مشروعًا' }, { role: 'assistant', content: 'جهزت' }],
      pending: { call_id: 'c_7', tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة' } },
    }))
    const ai = useAiRun()
    await ai.load('r_9')
    expect(ai.runId.value).toBe('r_9')
    expect(ai.status.value).toBe('waiting_user')
    expect(ai.items.value).toHaveLength(3)
    expect(ai.items.value.at(-1)).toMatchObject({ kind: 'draft', callId: 'c_7', summaryAr: 'pmo.draft_project', summaryEn: 'pmo.draft_project', state: 'pending' })
  })

  it('decide() marks the card and posts the decision with data once', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {
      run_id: 'r_9', status: 'waiting_user', messages: [],
      pending: { call_id: 'c_7', tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة' } },
    }))
    const ai = useAiRun()
    await ai.load('r_9')
    fetchMock.mockResolvedValueOnce(streamResponse(sse(['answer', { text: 'تم', records: [] }], ['done', { status: 'done' }])))
    await ai.decide('c_7', 'approved', { id: 41 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/ai/runs/r_9/resume')
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ call_id: 'c_7', decision: 'approved', data: { id: 41 } })
    expect(ai.items.value[0]).toMatchObject({ kind: 'draft', state: 'approved' })
    expect(ai.status.value).toBe('done')
  })

  it('load() of a missing run reports a generic error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { data: { code: 'not_found' } }))
    const ai = useAiRun()
    await ai.load('r_x')
    expect(ai.error.value).toBe('errors.generic')
    expect(ai.runId.value).toBeNull()
  })

  it('ends in failed when an error event is the last thing on the stream', async () => {
    fetchMock.mockResolvedValue(streamResponse(sse(['run', { run_id: 'r_1' }], ['error', { code: 'weird', message: 'raw detail' }])))
    const ai = useAiRun()
    await ai.send('س')
    expect(ai.status.value).toBe('failed')
    expect(ai.error.value).toBe('errors.generic')
  })

  it('ends in failed when the stream closes without done', async () => {
    fetchMock.mockResolvedValue(streamResponse(sse(['run', { run_id: 'r_1' }], ['token', { text: 'نص' }])))
    const ai = useAiRun()
    await ai.send('س')
    expect(ai.status.value).toBe('failed')
    expect(ai.error.value).toBe('errors.generic')
  })

  it('keeps the provider message when error is followed by done failed', async () => {
    fetchMock.mockResolvedValue(streamResponse(sse(['error', { code: 'provider_unavailable', message: 'x' }], ['done', { status: 'failed' }])))
    const ai = useAiRun()
    await ai.send('س')
    expect(ai.status.value).toBe('failed')
    expect(ai.error.value).toBe('ai.errors.provider')
  })

  it('fails with a fixed message when the fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('NetworkError sk-secret'))
    const ai = useAiRun()
    await ai.send('س')
    expect(ai.status.value).toBe('failed')
    expect(ai.error.value).toBe('errors.generic')
  })

  it('aborts the request when the owning scope is disposed, without an error state', async () => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    const scope = effectScope()
    const ai = scope.run(() => useAiRun())!
    const pending = ai.send('س')
    expect(signal?.aborted).toBe(false)
    scope.stop()
    await pending
    expect(signal?.aborted).toBe(true)
    expect(ai.status.value).not.toBe('failed')
    expect(ai.error.value).toBeNull()
  })

  it('ignores a send while another request is in flight', async () => {
    let release!: () => void
    fetchMock.mockImplementation(() => new Promise((resolve) => { release = () => resolve(streamResponse(sse(['done', { status: 'done' }]))) }))
    const ai = useAiRun()
    const first = ai.send('أ')
    await ai.send('ب')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ai.items.value).toEqual([{ kind: 'user', text: 'أ' }])
    release()
    await first
  })

  describe('decide() failures', () => {
    const pendingRun = jsonResponse(200, {
      run_id: 'r_9', status: 'waiting_user', messages: [],
      pending: { call_id: 'c_7', tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة' } },
    })

    it.each([409, 503])('reverts the card to pending on a %s and shows a fixed error', async (status) => {
      fetchMock.mockResolvedValueOnce(pendingRun.clone())
      const ai = useAiRun()
      await ai.load('r_9')
      fetchMock.mockResolvedValueOnce(jsonResponse(status, { data: { code: 'ai_unavailable', message: 'raw' } }))
      await ai.decide('c_7', 'approved', { id: 1 })
      expect(ai.items.value[0]).toMatchObject({ kind: 'draft', state: 'pending' })
      expect(ai.error.value).toBe('ai.errors.decide')
      expect(ai.unavailable.value).toBe(false)
      expect(ai.status.value).toBe('waiting_user')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('reverts the card to pending on a network failure', async () => {
      fetchMock.mockResolvedValueOnce(pendingRun.clone())
      const ai = useAiRun()
      await ai.load('r_9')
      fetchMock.mockRejectedValueOnce(new TypeError('offline'))
      await ai.decide('c_7', 'rejected')
      expect(ai.items.value[0]).toMatchObject({ state: 'pending' })
      expect(ai.error.value).toBe('ai.errors.decide')
    })

    it('posts once on a rapid double decide', async () => {
      fetchMock.mockResolvedValueOnce(pendingRun.clone())
      const ai = useAiRun()
      await ai.load('r_9')
      fetchMock.mockResolvedValueOnce(streamResponse(sse(['done', { status: 'done' }])))
      await Promise.all([ai.decide('c_7', 'approved'), ai.decide('c_7', 'approved')])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('load() of a run that is not simply waiting for the user', () => {
    const run = (status: string, pending: unknown) => jsonResponse(200, { run_id: 'r_9', status, messages: [{ role: 'user', content: 'س' }], pending })
    const read = { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', input: {} }
    const write = { call_id: 'c_3', tool: 'pmo.update_task_state', kind: 'write_light', input: { task_id: 7, state: 'done' } }

    it('offers a stalled read (waiting_tool) as a retry, not a spinner', async () => {
      fetchMock.mockResolvedValueOnce(run('waiting_tool', read))
      const ai = useAiRun()
      await ai.load('r_9')
      expect(ai.status.value).toBe('waiting_user')
      expect(ai.items.value.at(-1)).toMatchObject({ kind: 'tool', callId: 'c_1', state: 'stalled' })
    })
    it('retrying the stalled read posts "approved" and the result settles the item', async () => {
      fetchMock.mockResolvedValueOnce(run('waiting_tool', read))
      const ai = useAiRun()
      await ai.load('r_9')
      fetchMock.mockResolvedValueOnce(streamResponse(sse(
        ['tool_result', { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', ok: true, summary_ar: 'x', summary_en: 'x' }],
        ['answer', { text: 'تم', records: [] }], ['done', { status: 'done' }],
      )))
      expect(await ai.decide('c_1', 'approved')).toBe(true)
      expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ call_id: 'c_1', decision: 'approved' })
      expect(ai.items.value.find(item => item.kind === 'tool')).toMatchObject({ state: 'ok' })
      expect(ai.status.value).toBe('done')
    })
    it('puts a stalled read back to stalled when the retry never reached the server', async () => {
      fetchMock.mockResolvedValueOnce(run('waiting_tool', read))
      const ai = useAiRun()
      await ai.load('r_9')
      fetchMock.mockResolvedValueOnce(jsonResponse(409, { data: { code: 'conflict' } }))
      expect(await ai.decide('c_1', 'approved')).toBe(false)
      expect(ai.items.value.find(item => item.kind === 'tool')).toMatchObject({ state: 'stalled' })
      expect(ai.status.value).toBe('waiting_user')
    })
    it('shows an executing run as waiting_user with its pending write card disabled', async () => {
      fetchMock.mockResolvedValueOnce(run('executing', write))
      const ai = useAiRun()
      await ai.load('r_9')
      expect(ai.status.value).toBe('waiting_user')
      expect(ai.items.value.at(-1)).toMatchObject({ kind: 'confirm', callId: 'c_3', state: 'pending', busy: true })
    })
    it('does not mark a normal waiting_user write card busy', async () => {
      fetchMock.mockResolvedValueOnce(run('waiting_user', write))
      const ai = useAiRun()
      await ai.load('r_9')
      expect(ai.status.value).toBe('waiting_user')
      expect(ai.items.value.at(-1)).not.toHaveProperty('busy')
    })
    it('maps running to idle when this page started no stream', async () => {
      fetchMock.mockResolvedValueOnce(run('running', null))
      const ai = useAiRun()
      await ai.load('r_9')
      expect(ai.status.value).toBe('idle')
    })
    it('keeps running as streaming while this page is streaming', async () => {
      let release!: () => void
      fetchMock.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(streamResponse(sse(['done', { status: 'done' }]))) }))
      const ai = useAiRun()
      const sending = ai.send('س')
      fetchMock.mockResolvedValueOnce(run('running', null))
      await ai.load('r_9')
      expect(ai.status.value).toBe('streaming')
      release()
      await sending
    })
    it('maps waiting_tool without a pending call to idle, never a permanent spinner', async () => {
      fetchMock.mockResolvedValueOnce(run('waiting_tool', null))
      const ai = useAiRun()
      await ai.load('r_9')
      expect(ai.status.value).toBe('idle')
    })
  })

  describe('failures after the server accepted the decision', () => {
    const pendingWrite = () => jsonResponse(200, {
      run_id: 'r_9', status: 'waiting_user', messages: [],
      pending: { call_id: 'c_3', tool: 'pmo.update_task_state', kind: 'write_light', input: { task_id: 7 } },
    })
    it('keeps the card approved and shows the resume_failed message when the write ran but the resume failed', async () => {
      fetchMock.mockResolvedValueOnce(pendingWrite())
      const ai = useAiRun()
      await ai.load('r_9')
      fetchMock.mockResolvedValueOnce(streamResponse(sse(['error', { code: 'resume_failed', message: 'raw detail' }], ['done', { status: 'failed' }])))
      expect(await ai.decide('c_3', 'approved')).toBe(true)
      expect(ai.items.value[0]).toMatchObject({ kind: 'confirm', state: 'approved' })
      expect(ai.error.value).toBe('ai.errors.resumeFailed')
      expect(ai.status.value).toBe('failed')
    })
    it('shows audit_failed with its own message, not the generic one', async () => {
      fetchMock.mockResolvedValueOnce(pendingWrite())
      const ai = useAiRun()
      await ai.load('r_9')
      fetchMock.mockResolvedValueOnce(streamResponse(sse(['answer', { text: 'تم', records: [] }], ['error', { code: 'audit_failed', message: 'raw' }], ['done', { status: 'done' }])))
      await ai.decide('c_3', 'approved')
      expect(ai.error.value).toBe('ai.errors.auditFailed')
      expect(ai.items.value[0]).toMatchObject({ state: 'approved' })
    })
    it('keeps the card approved when the stream breaks after the server took the decision', async () => {
      fetchMock.mockResolvedValueOnce(pendingWrite())
      const ai = useAiRun()
      await ai.load('r_9')
      const broken = new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('network')) } }), { status: 200 })
      fetchMock.mockResolvedValueOnce(broken)
      expect(await ai.decide('c_3', 'approved')).toBe(true)
      expect(ai.items.value[0]).toMatchObject({ state: 'approved' })
      expect(ai.error.value).toBe('errors.generic')
    })
  })
})
