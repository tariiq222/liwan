import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser'
import { createStepUp } from '../composables/useStepUp'
import { authPost } from '../utils/authPost'

// One step-up flow per app: it holds the pending decision of the open confirmation, so every
// reader (the panel, the request helper) must reach the same instance through the Nuxt app.
export default defineNuxtPlugin((nuxtApp) => {
  const stepUp = createStepUp({
    post: authPost,
    authenticate: startAuthentication,
    onSessionEnded: () => nuxtApp.runWithContext(() => useSessionEnded()()),
    abortPrompt: () => WebAuthnAbortService.cancelCeremony(),
  }, {
    pending: useState('admin-step-up-pending', () => false),
    waiting: useState('admin-step-up-waiting', () => false),
    error: useState<string | null>('admin-step-up-error', () => null),
  })
  return { provide: { stepUp } }
})
