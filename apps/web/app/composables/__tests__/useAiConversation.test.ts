import { computed, effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAiRun } from '../useAiRun'
import { followSharedConversation, useAiConversation } from '../useAiConversation'

function stubState() {
  const me = ref<{ id: number; company: { id: number } } | null>({ id: 7, company: { id: 1 } })
  vi.stubGlobal('useMe', () => ({ me }))
  const states = new Map<string, ReturnType<typeof ref>>()
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!states.has(key)) states.set(key, ref(init()))
    return states.get(key)
  })
  return me
}

// A surface's own run: `load` gives it the id it was asked for, as the real one does once the fetch answers.
function fakeRun() {
  const runId = ref<string | null>(null)
  const load = vi.fn(async (id: string) => { runId.value = id })
  const reset = vi.fn(() => { runId.value = null })
  return { runId, streaming: ref(false), load, reset }
}
const follow = (run: ReturnType<typeof fakeRun>, enabled = () => true) => effectScope().run(() => followSharedConversation(run, enabled))!
const settle = async () => { await nextTick(); await nextTick() }

afterEach(() => vi.unstubAllGlobals())

describe('the shared conversation', () => {
  it('does not republish a run queued in the same tick as logout', async () => {
    const me = stubState()
    const run = fakeRun()
    const scope = effectScope()
    scope.run(() => followSharedConversation(run, () => true))
    run.runId.value = 'ending-identity-run'
    me.value = null
    await settle()
    expect(useAiConversation().currentRunId.value).toBeNull()
    expect(run.runId.value).toBeNull()
    scope.stop()
  })

  it('does not restore a previous identity run when its response body finishes after logout', async () => {
    const me = stubState()
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    let finishBody!: (body: unknown) => void
    let bodyStarted!: () => void
    const bodyReading = new Promise<void>(resolve => { bodyStarted = resolve })
    const body = new Promise(resolve => { finishBody = resolve })
    const fetch = vi.fn(async () => ({ ok: true, json: () => { bodyStarted(); return body } }))
    vi.stubGlobal('fetch', fetch)
    const scope = effectScope()
    const run = scope.run(() => useAiRun())!
    const streaming = computed(() => run.status.value === 'streaming')
    scope.run(() => followSharedConversation({ ...run, streaming }, () => true))
    useAiConversation().currentRunId.value = 'identity-a-run'
    await bodyReading
    me.value = null
    me.value = { id: 8, company: { id: 1 } }
    finishBody({ run_id: 'identity-a-run', status: 'done', messages: [{ role: 'assistant', content: 'private answer' }], pending: null })
    await settle()
    expect(useAiConversation().currentRunId.value).toBeNull()
    expect(run.runId.value).toBeNull()
    expect(run.items.value).toEqual([])
    expect(run.status.value).toBe('idle')
    expect(fetch).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it.each(['logout', 'user', 'company'])('forgets the conversation and both local runs on %s identity change', async (change) => {
    const me = stubState()
    const scope = effectScope()
    const page = fakeRun()
    const sheet = fakeRun()
    const shown = ref(true)
    scope.run(() => {
      followSharedConversation(page, () => true)
      followSharedConversation(sheet, () => shown.value)
    })
    page.runId.value = 'previous-identity-run'
    await settle()
    shown.value = false
    await settle()
    page.load.mockClear()
    sheet.load.mockClear()
    me.value = change === 'logout' ? null : { id: change === 'user' ? 8 : 7, company: { id: change === 'company' ? 2 : 1 } }
    await settle()
    expect(useAiConversation().currentRunId.value).toBeNull()
    expect(page.runId.value).toBeNull()
    expect(sheet.runId.value).toBeNull()
    if (change === 'logout') me.value = { id: 8, company: { id: 1 } }
    shown.value = true
    await settle()
    expect(page.load).not.toHaveBeenCalled()
    expect(sheet.load).not.toHaveBeenCalled()
    scope.stop()
  })

  it('is one id for every surface that asks', () => {
    stubState()
    expect(useAiConversation().currentRunId).toBe(useAiConversation().currentRunId)
  })

  it('opens the run the other surface has open when the sheet mounts', async () => {
    stubState()
    useAiConversation().currentRunId.value = 'run-1'
    const run = fakeRun()
    follow(run)
    await settle()
    expect(run.load).toHaveBeenCalledWith('run-1')
    expect(run.runId.value).toBe('run-1')
  })

  it('writes its own new run back so the full page can open the same one', async () => {
    stubState()
    const run = fakeRun()
    follow(run)
    run.runId.value = 'run-7'
    await settle()
    expect(useAiConversation().currentRunId.value).toBe('run-7')
    expect(run.load).not.toHaveBeenCalled()
  })

  it('follows the other surface to another run, and to a new conversation', async () => {
    stubState()
    const run = fakeRun()
    follow(run)
    const { currentRunId } = useAiConversation()
    currentRunId.value = 'run-2'
    await settle()
    expect(run.runId.value).toBe('run-2')
    currentRunId.value = null
    await settle()
    expect(run.reset).toHaveBeenCalled()
    expect(run.runId.value).toBeNull()
  })

  it('stays out of it while the surface is disabled', async () => {
    stubState()
    useAiConversation().currentRunId.value = 'run-1'
    const run = fakeRun()
    follow(run, () => false)
    await settle()
    expect(run.load).not.toHaveBeenCalled()
  })

  it('makes no request while hidden and brings the run up to date when shown', async () => {
    stubState()
    const shown = ref(false)
    const run = fakeRun()
    follow(run, () => shown.value)
    useAiConversation().currentRunId.value = 'run-1'
    await settle()
    expect(run.load).not.toHaveBeenCalled()
    shown.value = true
    await settle()
    expect(run.load).toHaveBeenCalledTimes(1)
    expect(run.load).toHaveBeenCalledWith('run-1')
  })

  it('reloads the same run when shown again, since the other surface may have advanced it', async () => {
    stubState()
    const shown = ref(true)
    const run = fakeRun()
    useAiConversation().currentRunId.value = 'run-1'
    follow(run, () => shown.value)
    await settle()
    run.reset.mockClear()
    shown.value = false
    await settle()
    shown.value = true
    await settle()
    expect(run.load).toHaveBeenCalledTimes(2)
    expect(run.reset).not.toHaveBeenCalled()
  })

  it('resets before loading when the shared run differs, and forgets its run when the conversation ended elsewhere', async () => {
    stubState()
    const shown = ref(true)
    const run = fakeRun()
    const { currentRunId } = useAiConversation()
    currentRunId.value = 'run-1'
    follow(run, () => shown.value)
    await settle()
    run.reset.mockClear()
    shown.value = false
    await settle()
    currentRunId.value = 'run-2'
    shown.value = true
    await settle()
    expect(run.reset).toHaveBeenCalledTimes(1)
    expect(run.runId.value).toBe('run-2')
    shown.value = false
    await settle()
    currentRunId.value = null
    shown.value = true
    await settle()
    expect(run.runId.value).toBeNull()
  })

  it('does not reload a streaming run when shown', async () => {
    stubState()
    const shown = ref(false)
    const run = fakeRun()
    useAiConversation().currentRunId.value = 'run-1'
    follow(run, () => shown.value)
    run.streaming.value = true
    shown.value = true
    await settle()
    expect(run.load).not.toHaveBeenCalled()
  })

  it('starts a new conversation everywhere', async () => {
    stubState()
    const run = fakeRun()
    const { startNew } = follow(run)
    run.runId.value = 'run-3'
    await settle()
    startNew()
    expect(run.reset).toHaveBeenCalled()
    expect(useAiConversation().currentRunId.value).toBeNull()
  })
})
