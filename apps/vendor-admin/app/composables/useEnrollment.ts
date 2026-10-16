import { reactive, ref } from 'vue'
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON, type RegistrationResponseJSON } from '@simplewebauthn/browser'
import { authErrorKey, statusOf } from '../utils/authError'
import { authPost, type AuthPost } from '../utils/authPost'
import { takeInvitationToken } from '../utils/invitationToken'
import { groupedTotpSecret } from '../utils/totp'

/** `invalid`: the link is refused; `retry`: it could not be checked right now (the link is kept). */
export type EnrollmentStep = 'checking' | 'invalid' | 'retry' | 'passkey' | 'totp' | 'recovery'

const MIN_PASSWORD_LENGTH = 12

export interface EnrollmentDeps {
  post: AuthPost
  register: (options: { optionsJSON: PublicKeyCredentialCreationOptionsJSON }) => Promise<RegistrationResponseJSON>
  refresh: () => Promise<void>
  go: (path: string) => unknown
  /** Reads the token from the address fragment and removes the fragment. */
  takeToken: () => Promise<string | null>
}

/**
 * The invitation flow. The token, the setup box, the password and the recovery codes live only in
 * this closure: none is stored, logged or put in an address.
 */
export function createEnrollment(deps: EnrollmentDeps) {
  const step = ref<EnrollmentStep>('checking')
  const pending = ref(false)
  const errorKey = ref<string | null>(null)
  const email = ref('')
  const label = ref('')
  const totpUri = ref<string | null>(null)
  const totpSecret = ref<string | null>(null)
  const form = reactive({ password: '', confirm: '', totpCode: '' })
  const recoveryCodes = ref<string[]>([])
  const saved = ref(false)
  let token = ''
  let totpBox = ''

  async function work(action: () => Promise<void>): Promise<void> {
    if (pending.value) return
    pending.value = true
    errorKey.value = null
    try {
      await action()
    } catch (error) {
      errorKey.value = authErrorKey(error)
    } finally {
      pending.value = false
    }
  }

  async function start(): Promise<void> {
    const found = await deps.takeToken()
    if (!found) {
      errorKey.value = 'adminAuth.errors.failed'
      step.value = 'invalid'
      return
    }
    token = found
    await checkInvitation()
  }

  /** Asks the server about the link; only a refusal makes it invalid, any other failure can be retried. */
  async function checkInvitation(): Promise<void> {
    await work(async () => {
      try {
        const invitation = await deps.post<{ email: string }>('/api/auth/enroll/invitation', { token })
        email.value = invitation.email
        step.value = 'passkey'
      } catch (error) {
        step.value = [401, 422].includes(statusOf(error) ?? 0) ? 'invalid' : 'retry'
        throw error
      }
    })
  }

  async function loadTotp(): Promise<void> {
    await work(async () => {
      const setup = await deps.post<{ totp_uri: string, totp_box: string }>('/api/auth/enroll/totp', { token })
      totpUri.value = setup.totp_uri
      totpSecret.value = groupedTotpSecret(setup.totp_uri)
      totpBox = setup.totp_box
    })
  }

  async function registerPasskey(): Promise<void> {
    await work(async () => {
      const challenge = await deps.post<{ challenge_id: string, options: PublicKeyCredentialCreationOptionsJSON }>('/api/auth/enroll/passkey-options', { token })
      const response = await deps.register({ optionsJSON: challenge.options })
      await deps.post('/api/auth/enroll/passkey-verify', { token, challenge_id: challenge.challenge_id, response, label: label.value.trim() })
      step.value = 'totp'
    })
    if (step.value === 'totp') await loadTotp()
  }

  async function complete(): Promise<void> {
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      errorKey.value = 'adminAuth.enroll.errors.passwordShort'
      return
    }
    if (form.password !== form.confirm) {
      errorKey.value = 'adminAuth.enroll.errors.passwordMismatch'
      return
    }
    await work(async () => {
      const done = await deps.post<{ recovery_codes: string[] }>('/api/auth/enroll/complete', {
        token, password: form.password, totp_code: form.totpCode.trim(), totp_box: totpBox,
      })
      recoveryCodes.value = done.recovery_codes
      Object.assign(form, { password: '', confirm: '', totpCode: '' })
      totpUri.value = null
      totpSecret.value = null
      totpBox = ''
      token = ''
      step.value = 'recovery'
    })
  }

  async function finish(): Promise<void> {
    if (!saved.value) return
    await work(async () => {
      await deps.refresh()
      await deps.go('/')
      recoveryCodes.value = []
    })
  }

  return { step, pending, errorKey, email, label, totpUri, totpSecret, form, recoveryCodes, saved, start, checkInvitation, loadTotp, registerPasskey, complete, finish }
}

export function useEnrollment() {
  const { refresh } = useAdminSession()
  const router = useRouter()
  return createEnrollment({
    post: authPost,
    register: startRegistration,
    refresh,
    go: path => navigateTo(path),
    takeToken: () => takeInvitationToken(window.location.hash, () => router.replace({ path: router.currentRoute.value.path, query: router.currentRoute.value.query, hash: '' })),
  })
}
