import { describe, expect, it, vi } from 'vitest'
import { createStepUp, StepUpCancelled, type StepUpDeps } from '../useStepUp'

const OPTIONS = { challenge: 'abc' }
const failure = (statusCode: number, code?: string) => Object.assign(new Error('fetch failed'), { statusCode, data: code ? { code } : undefined })
const abort = () => Object.assign(new Error('prompt closed'), { name: 'NotAllowedError' })

function setup(overrides: Partial<StepUpDeps> = {}) {
  const order: string[] = []
  const post = vi.fn(async (path: string) => {
    order.push(path)
    return path.endsWith('options') ? { challenge_id: 'c'.repeat(36), options: OPTIONS } : undefined
  })
  const authenticate = vi.fn(async () => { order.push('authenticate'); return { id: 'assertion' } })
  const onSessionEnded = vi.fn()
  const abortPrompt = vi.fn()
  const stepUp = createStepUp({ post: post as StepUpDeps['post'], authenticate: authenticate as unknown as StepUpDeps['authenticate'], onSessionEnded, abortPrompt, devLogin: false, ...overrides })
  return { stepUp, post, authenticate, onSessionEnded, abortPrompt, order }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('createStepUp', () => {
  it('asks for options, one passkey assertion and the verification, then runs the request once', async () => {
    const { stepUp, post, order } = setup()
    const retry = vi.fn().mockResolvedValue('saved')
    await expect(stepUp.run(retry)).resolves.toBe('saved')
    expect(order).toEqual(['/api/auth/step-up-options', 'authenticate', '/api/auth/step-up-verify'])
    expect(post).toHaveBeenLastCalledWith('/api/auth/step-up-verify', { challenge_id: 'c'.repeat(36), response: { id: 'assertion' } })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(stepUp.pending.value).toBe(false)
  })

  it('shows the panel while the passkey prompt is open', async () => {
    let finish!: (value: unknown) => void
    const { stepUp } = setup({ authenticate: (() => new Promise((resolve) => { finish = resolve })) as unknown as StepUpDeps['authenticate'] })
    const running = stepUp.run(async () => 'done')
    await tick()
    expect(stepUp.pending.value).toBe(true)
    expect(stepUp.waiting.value).toBe(false)
    finish({ id: 'assertion' })
    await running
    expect(stepUp.pending.value).toBe(false)
  })

  it('keeps the panel after a cancelled prompt, offers Retry and runs the request once after it succeeds', async () => {
    const authenticate = vi.fn().mockRejectedValueOnce(abort()).mockResolvedValue({ id: 'assertion' })
    const { stepUp } = setup({ authenticate: authenticate as unknown as StepUpDeps['authenticate'] })
    const retry = vi.fn().mockResolvedValue('saved')
    const running = stepUp.run(retry)
    await tick()
    expect(stepUp.pending.value).toBe(true)
    expect(stepUp.waiting.value).toBe(true)
    expect(stepUp.error.value).toBe('adminAuth.errors.passkeyCancelled')
    expect(retry).not.toHaveBeenCalled()
    stepUp.retry()
    await expect(running).resolves.toBe('saved')
    expect(authenticate).toHaveBeenCalledTimes(2)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(stepUp.error.value).toBeNull()
  })

  it('rejects with StepUpCancelled and never runs the request when the person cancels', async () => {
    const { stepUp } = setup({ authenticate: vi.fn().mockRejectedValue(abort()) as unknown as StepUpDeps['authenticate'] })
    const retry = vi.fn()
    const running = stepUp.run(retry)
    await tick()
    stepUp.cancel()
    await expect(running).rejects.toBeInstanceOf(StepUpCancelled)
    expect(retry).not.toHaveBeenCalled()
    expect(stepUp.pending.value).toBe(false)
    expect(stepUp.error.value).toBeNull()
  })

  it('cancels while the prompt is still open without sending the verification', async () => {
    let finish!: (value: unknown) => void
    const { stepUp, post } = setup({ authenticate: (() => new Promise((resolve) => { finish = resolve })) as unknown as StepUpDeps['authenticate'] })
    const retry = vi.fn()
    const running = stepUp.run(retry)
    await tick()
    stepUp.cancel()
    finish({ id: 'assertion' })
    await expect(running).rejects.toBeInstanceOf(StepUpCancelled)
    expect(post).not.toHaveBeenCalledWith('/api/auth/step-up-verify', expect.anything())
    expect(retry).not.toHaveBeenCalled()
  })

  it('cancels at once, and closes the browser prompt, when it never answers', async () => {
    const { stepUp, abortPrompt } = setup({ authenticate: (() => new Promise(() => undefined)) as unknown as StepUpDeps['authenticate'] })
    const retry = vi.fn()
    const running = stepUp.run(retry)
    await tick()
    stepUp.cancel()
    await expect(running).rejects.toBeInstanceOf(StepUpCancelled)
    expect(abortPrompt).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
    expect(stepUp.pending.value).toBe(false)
  })

  it('treats a rejected assertion on the server as a retryable failure, not a sign-out', async () => {
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('verify') && post.mock.calls.filter(([p]) => p === path).length === 1) throw failure(401, 'auth_failed')
      return path.endsWith('options') ? { challenge_id: 'c'.repeat(36), options: OPTIONS } : undefined
    })
    const { stepUp, onSessionEnded } = setup({ post: post as unknown as StepUpDeps['post'] })
    const running = stepUp.run(async () => 'ok')
    await tick()
    expect(stepUp.error.value).toBe('adminAuth.errors.failed')
    stepUp.retry()
    await expect(running).resolves.toBe('ok')
    expect(onSessionEnded).not.toHaveBeenCalled()
  })

  it('ends the session when the options call says it is gone', async () => {
    const post = vi.fn().mockRejectedValue(failure(401, 'auth_failed'))
    const { stepUp, onSessionEnded } = setup({ post })
    const retry = vi.fn()
    await expect(stepUp.run(retry)).rejects.toMatchObject({ statusCode: 401 })
    expect(onSessionEnded).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
    expect(stepUp.pending.value).toBe(false)
  })

  it('is offered only when the development flag is on', () => {
    expect(setup().stepUp.devEnabled).toBe(false)
    expect(setup({ devLogin: true }).stepUp.devEnabled).toBe(true)
  })

  it('ends the open passkey prompt when the developer confirmation succeeds, without verifying a passkey', async () => {
    const { stepUp, post, abortPrompt } = setup({ devLogin: true, authenticate: (() => new Promise(() => undefined)) as unknown as StepUpDeps['authenticate'] })
    const retry = vi.fn().mockResolvedValue('saved')
    const running = stepUp.run(retry)
    await tick()
    await stepUp.confirmWithDev()
    await expect(running).resolves.toBe('saved')
    expect(post).toHaveBeenCalledWith('/api/auth/dev-step-up', {})
    expect(post).not.toHaveBeenCalledWith('/api/auth/step-up-verify', expect.anything())
    expect(abortPrompt).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(stepUp.pending.value).toBe(false)
  })

  it('also completes from the Retry state after a cancelled prompt', async () => {
    const authenticate = vi.fn().mockRejectedValue(abort())
    const { stepUp } = setup({ devLogin: true, authenticate: authenticate as unknown as StepUpDeps['authenticate'] })
    const running = stepUp.run(async () => 'saved')
    await tick()
    expect(stepUp.waiting.value).toBe(true)
    await stepUp.confirmWithDev()
    await expect(running).resolves.toBe('saved')
    expect(authenticate).toHaveBeenCalledTimes(1)
  })

  it('keeps the panel open and shows the failure when the developer confirmation is refused', async () => {
    const post = vi.fn(async (path: string) => {
      if (path === '/api/auth/dev-step-up') throw failure(404, 'not_found')
      return path.endsWith('options') ? { challenge_id: 'c'.repeat(36), options: OPTIONS } : undefined
    })
    const { stepUp } = setup({ devLogin: true, post: post as unknown as StepUpDeps['post'], authenticate: (() => new Promise(() => undefined)) as unknown as StepUpDeps['authenticate'] })
    const retry = vi.fn()
    const running = stepUp.run(retry)
    await tick()
    await stepUp.confirmWithDev()
    expect(stepUp.pending.value).toBe(true)
    expect(stepUp.error.value).toBe('adminAuth.errors.generic')
    stepUp.cancel()
    await expect(running).rejects.toBeInstanceOf(StepUpCancelled)
    expect(retry).not.toHaveBeenCalled()
  })

  it('shares one ceremony between requests that need a step-up at the same time', async () => {
    const { stepUp, authenticate } = setup()
    const first = vi.fn().mockResolvedValue(1)
    const second = vi.fn().mockResolvedValue(2)
    await expect(Promise.all([stepUp.run(first), stepUp.run(second)])).resolves.toEqual([1, 2])
    expect(authenticate).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('passes a failure of the retried request through untouched', async () => {
    const { stepUp } = setup()
    const error = failure(409, 'conflict')
    await expect(stepUp.run(() => Promise.reject(error))).rejects.toBe(error)
    expect(stepUp.pending.value).toBe(false)
  })

  it('rejects and does not repeat the request when cancelled while the verification is in flight', async () => {
    let finishVerify!: () => void
    const base = setup()
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('verify')) await new Promise<void>((resolve) => { finishVerify = resolve })
      return path.endsWith('options') ? { challenge_id: 'c'.repeat(36), options: OPTIONS } : undefined
    })
    const { stepUp } = setup({ post: post as unknown as StepUpDeps['post'] })
    const retry = vi.fn()
    const running = stepUp.run(retry)
    await tick()
    await tick()
    stepUp.cancel()
    finishVerify()
    await expect(running).rejects.toBeInstanceOf(StepUpCancelled)
    expect(retry).not.toHaveBeenCalled()
    expect(base.stepUp.pending.value).toBe(false)
  })

  it('does not open the passkey prompt when cancelled while the options are loading', async () => {
    let finishOptions!: () => void
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('options')) await new Promise<void>((resolve) => { finishOptions = resolve })
      return { challenge_id: 'c'.repeat(36), options: OPTIONS }
    })
    const { stepUp, authenticate } = setup({ post: post as unknown as StepUpDeps['post'] })
    const retry = vi.fn()
    const running = stepUp.run(retry)
    await tick()
    stepUp.cancel()
    finishOptions()
    await expect(running).rejects.toBeInstanceOf(StepUpCancelled)
    expect(authenticate).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
  })

  it('never runs the request when the flow was cancelled by the time it finishes', async () => {
    const { stepUp } = setup()
    const retry = vi.fn()
    const running = stepUp.run(retry)
    stepUp.cancel()
    await expect(running).rejects.toBeInstanceOf(StepUpCancelled)
    expect(retry).not.toHaveBeenCalled()
  })
})
