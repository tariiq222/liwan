import { ref, type Ref } from 'vue'
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { authErrorKey, statusOf } from '../utils/authError'
import type { AuthPost } from '../utils/authPost'

/** The person closed the step-up panel: the request that needed it was not sent again. */
export class StepUpCancelled extends Error {
  constructor() {
    super('step_up_cancelled')
    this.name = 'StepUpCancelled'
  }
}

const isStepUpCancelled = (error: unknown): error is StepUpCancelled => error instanceof StepUpCancelled

export interface StepUpDeps {
  post: AuthPost
  authenticate: (options: { optionsJSON: PublicKeyCredentialRequestOptionsJSON }) => Promise<AuthenticationResponseJSON>
  /** The session behind the cookie is gone. */
  onSessionEnded: () => unknown
  /** Closes the browser's passkey prompt when the person cancels while it is open. */
  abortPrompt: () => void
  /** Local development only: the panel offers a confirmation without a passkey. */
  devLogin: boolean
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
  let cancelPrompt: (() => void) | null = null
  let devConfirmed = false
  let skipPasskey: (() => void) | null = null

  const choose = (choice: Choice) => {
    const settle = decision
    decision = null
    settle?.(choice)
  }
  const waitForChoice = () => new Promise<Choice>((resolve) => { decision = resolve })

  /** One passkey assertion: options, the browser prompt, verification. */
  async function assertOnce(): Promise<void> {
    if (devConfirmed) return
    const challenge = await deps.post<{ challenge_id: string, options: PublicKeyCredentialRequestOptionsJSON }>('/api/auth/step-up-options', {})
      .catch(async (error: unknown) => {
        if (statusOf(error) !== 401) throw error
        await deps.onSessionEnded()
        throw new SessionGone(error)
      })
    if (cancelled) throw new StepUpCancelled()
    if (devConfirmed) return
    const prompt = deps.authenticate({ optionsJSON: challenge.options })
    // A prompt the person cancelled settles at once, whatever the browser does with it.
    const dismissed = new Promise<never>((_, reject) => { cancelPrompt = () => reject(new StepUpCancelled()) })
    // The developer confirmation replaces the assertion: the prompt is closed and nothing is verified.
    const skipped = new Promise<undefined>((resolve) => { skipPasskey = () => resolve(undefined) })
    const response = await Promise.race([prompt, dismissed, skipped]).finally(() => { cancelPrompt = null; skipPasskey = null })
    if (cancelled) throw new StepUpCancelled()
    if (!response) return
    await deps.post('/api/auth/step-up-verify', { challenge_id: challenge.challenge_id, response })
  }

  async function confirm(): Promise<void> {
    cancelled = false
    devConfirmed = false
    state.pending.value = true
    try {
      for (;;) {
        state.error.value = null
        try {
          await assertOnce()
          if (cancelled) throw new StepUpCancelled()
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
    // Cancelled after the confirmation went through: the request must not be sent again.
    if (cancelled) throw new StepUpCancelled()
    return fn()
  }

  /** Local development only: the control plane marks the session as stepped up; the open passkey confirmation ends. */
  async function confirmWithDev(): Promise<void> {
    try {
      await deps.post('/api/auth/dev-step-up', {})
    } catch (error) {
      state.error.value = authErrorKey(error)
      return
    }
    devConfirmed = true
    skipPasskey?.()
    deps.abortPrompt()
    choose('retry')
  }

  return {
    ...state,
    devEnabled: deps.devLogin,
    confirmWithDev,
    run,
    retry: () => choose('retry'),
    cancel: () => {
      cancelled = true
      deps.abortPrompt()
      cancelPrompt?.()
      choose('cancel')
    },
  }
}

/** The app's one step-up flow (see plugins/stepUp.ts). */
export function useStepUp() {
  return useNuxtApp().$stepUp
}
