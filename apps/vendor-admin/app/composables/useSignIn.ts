import { reactive, ref } from 'vue'
import { startAuthentication, type AuthenticationResponseJSON, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { authErrorKey } from '../utils/authError'
import { authPost, type AuthPost } from '../utils/authPost'
import { safeSameAppPath } from '@nasq/ui/app/utils/safeReturnTo'
import { AUTH_PATHS } from '../utils/authPaths'

export type SignInMode = 'passkey' | 'fallback' | 'recovery'

export interface SignInDeps {
  post: AuthPost
  authenticate: (options: { optionsJSON: PublicKeyCredentialRequestOptionsJSON }) => Promise<AuthenticationResponseJSON>
  refresh: () => Promise<void>
  go: (path: string) => unknown
  /** The untrusted `next` query value. */
  next: () => unknown
  /** Local development only: the one-click sign-in is offered. */
  devLogin: boolean
}

export function createSignIn(deps: SignInDeps) {
  const mode = ref<SignInMode>('passkey')
  const pending = ref(false)
  const errorKey = ref<string | null>(null)
  const form = reactive({ email: '', password: '', totpCode: '', recoveryCode: '' })

  async function attempt(authenticateWith: () => Promise<unknown>): Promise<void> {
    if (pending.value) return
    pending.value = true
    errorKey.value = null
    try {
      await authenticateWith()
      form.password = ''
      form.totpCode = ''
      form.recoveryCode = ''
      await deps.refresh()
      await deps.go(safeSameAppPath(deps.next(), AUTH_PATHS) ?? '/')
    } catch (error) {
      errorKey.value = authErrorKey(error)
      form.totpCode = ''
      form.recoveryCode = ''
    } finally {
      pending.value = false
    }
  }

  const signInWithPasskey = () => attempt(async () => {
    const challenge = await deps.post<{ challenge_id: string, options: PublicKeyCredentialRequestOptionsJSON }>('/api/auth/passkey-options', {})
    const response = await deps.authenticate({ optionsJSON: challenge.options })
    await deps.post('/api/auth/passkey-verify', { challenge_id: challenge.challenge_id, response })
  })

  const signInWithDev = () => attempt(() => deps.post('/api/auth/dev-login', {}))

  const signInWithPassword = () => attempt(() => {
    const email = form.email.trim()
    return mode.value === 'recovery'
      ? deps.post('/api/auth/recovery', { email, password: form.password, recovery_code: form.recoveryCode.trim() })
      : deps.post('/api/auth/fallback', { email, password: form.password, totp_code: form.totpCode.trim() })
  })

  function setMode(next: SignInMode): void {
    mode.value = next
    errorKey.value = null
  }

  return { mode, pending, errorKey, form, devEnabled: deps.devLogin, signInWithPasskey, signInWithPassword, signInWithDev, setMode }
}

export function useSignIn() {
  const { refresh } = useAdminSession()
  const route = useRoute()
  return createSignIn({
    post: authPost,
    authenticate: startAuthentication,
    refresh,
    go: path => navigateTo(path),
    next: () => route.query.next,
    devLogin: useRuntimeConfig().public.devLogin === true,
  })
}
