import { ref, type Ref } from 'vue'
import { startAuthentication, type AuthenticationResponseJSON, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { authErrorKey, statusOf } from '../utils/authError'
import { authPost, type AuthPost } from '../utils/authPost'

/** The person closed the step-up panel: the request that needed it was not sent again. */
export class StepUpCancelled extends Error {
  constructor() {
    super('step_up_cancelled')
    this.name = 'StepUpCancelled'
  }
}

export const isStepUpCancelled = (error: unknown): error is StepUpCancelled => error instanceof StepUpCancelled

/** The inline message a form shows when the person did not confirm; null for any other failure. */
export const stepUpCancelledKey = (error: unknown): string | null => isStepUpCancelled(error) ? 'adminAuth.stepUp.cancelled' : null

export interface StepUpDeps {
  post: AuthPost
  authenticate: (options: { optionsJSON: PublicKeyCredentialRequestOptionsJSON }) => Promise<AuthenticationResponseJSON>
  /** The session behind the cookie is gone. */
  onSessionEnded: () => unknown
}

export interface StepUpState {
  /** The panel is shown: a passkey confirmation is open or waiting for a decision. */
  pending: Ref<boolean>
  /** The last attempt failed and Retry or Cancel is awaited. */
  waiting: Ref<boolean>
  error: Ref<string | null>
}

type Choice = 'retry' | 'cancel'

/** Thrown inside the ceremony when the options call finds the session gone; carries the original failure. */
class SessionGone extends Error {
  constructor(readonly original: unknown) {
    super('session_gone')
  }
}

export function createStepUp(deps: StepUpDeps, state: StepUpState = { pending: ref(false), waiting: ref(false), error: ref<string | null>(null) }) {
  let decision: ((choice: Choice) => void) | null = null
  let ceremony: Promise<void> | null = null
  let cancelled = false

  const choose = (choice: Choice) => {
    const settle = decision
    decision = null
    settle?.(choice)
  }
  const waitForChoice = () => new Promise<Choice>((resolve) => { decision = resolve })

  /** One passkey assertion: options, the browser prompt, verification. */
  async function assertOnce(): Promise<void> {
    const challenge = await deps.post<{ challenge_id: string, options: PublicKeyCredentialRequestOptionsJSON }>('/api/auth/step-up-options', {})
      .catch(async (error: unknown) => {
        if (statusOf(error) !== 401) throw error
        await deps.onSessionEnded()
        throw new SessionGone(error)
      })
    const response = await deps.authenticate({ optionsJSON: challenge.options })
    if (cancelled) throw new StepUpCancelled()
    await deps.post('/api/auth/step-up-verify', { challenge_id: challenge.challenge_id, response })
  }

  async function confirm(): Promise<void> {
    cancelled = false
    state.pending.value = true
    try {
      for (;;) {
        state.error.value = null
        try {
          await assertOnce()
          return
        } catch (error) {
          if (error instanceof SessionGone) throw error.original
          if (cancelled || isStepUpCancelled(error)) throw new StepUpCancelled()
          state.error.value = authErrorKey(error)
          state.waiting.value = true
          const choice = await waitForChoice()
          state.waiting.value = false
          if (choice === 'cancel') throw new StepUpCancelled()
        }
      }
    } finally {
      state.pending.value = false
      state.waiting.value = false
      state.error.value = null
    }
  }

  /** Confirms with a passkey (once, however many requests wait), then runs `fn` exactly once. */
  async function run<T>(fn: () => Promise<T>): Promise<T> {
    ceremony ??= confirm().finally(() => { ceremony = null })
    await ceremony
    return fn()
  }

  return {
    ...state,
    run,
    retry: () => choose('retry'),
    cancel: () => {
      cancelled = true
      choose('cancel')
    },
  }
}

// The ceremony's pending decision lives in the closure, so there is one per app (keyed by its shared state).
const instances = new WeakMap<object, ReturnType<typeof createStepUp>>()

export function useStepUp() {
  const state: StepUpState = {
    pending: useState('admin-step-up-pending', () => false),
    waiting: useState('admin-step-up-waiting', () => false),
    error: useState<string | null>('admin-step-up-error', () => null),
  }
  let instance = instances.get(state.pending)
  if (!instance) {
    instance = createStepUp({ post: authPost, authenticate: startAuthentication, onSessionEnded: useSessionEnded() }, state)
    instances.set(state.pending, instance)
  }
  return instance
}
