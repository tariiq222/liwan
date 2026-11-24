<script setup lang="ts">
import type { FormError } from '@nuxt/ui'
import { LoginChannelsSchema, LoginStepSchema, LoginVerifyResultSchema, type LoginChannel, type LoginChannels, type LoginCodeSent } from '@liwan/contracts'
import LoginCodeStep from '@/components/auth/LoginCodeStep.vue'
import { errorCode, errorKey, errorSeconds, offeredChannels, preferredChannel } from '~/components/auth/loginFlow'
import { postLoginPath } from '~/utils/accessPolicy'

definePageMeta({ layout: false, access: 'guest' })

const { t } = useI18n()
const { branding } = useBranding()
const productName = computed(() => branding.value?.name ?? t('app.productName'))
const route = useRoute()
const { me, refresh } = useMe()

// ?login= only prefills the username (the invitation page links here); it is never trusted beyond that.
const queryLogin = typeof route.query.login === 'string' ? route.query.login.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128) : ''
const state = reactive({ login: queryLogin, password: '' })
const step = ref<'password' | 'code'>('password')
const pending = ref(false)
const errorMessage = ref<string | null>(route.query.reason === 'tenant_suspended' ? t('auth.tenantSuspended') : null)
const channels = ref<LoginChannels | null>(null)
const channel = ref<LoginChannel | null>(null)
const sent = ref<LoginCodeSent | null>(null)
const wait = ref<{ seconds: number } | null>(null)
const headerHint = computed(() => (step.value === 'password' ? t('auth.signInToContinue') : t('auth.codeTitle')))

// Guards the submit button until the client has hydrated: submitting before hydration falls through to a
// native, unhandled form POST. See useHydrated() for why. The inputs stay enabled so a password manager can
// fill the server-rendered form on first paint — but v-model resets those nodes when hydration reaches them,
// so read whatever is already in the DOM before that happens and adopt it.
const hydrated = useHydrated()
const prefilled: Record<string, string> = {}
onBeforeMount(() => {
  for (const id of ['login', 'password']) {
    prefilled[id] = (document.getElementById(id) as HTMLInputElement | null)?.value ?? ''
  }
})
onMounted(() => {
  if (!state.login && prefilled.login) state.login = prefilled.login
  if (!state.password && prefilled.password) state.password = prefilled.password
})

// Native browser validation is off (novalidate on both forms); these messages are Arabic/English from the
// active locale and show under the field. The submit button stays enabled so an empty submit explains itself.
function validate(value: Partial<typeof state>): FormError[] {
  const errors: FormError[] = []
  if (!value.login?.trim()) errors.push({ name: 'login', message: t('auth.usernameRequired') })
  if (!value.password) errors.push({ name: 'password', message: t('auth.passwordRequired') })
  return errors
}

/** The failure as one sentence in the active locale: the machine code picks it, never the server's prose.
 * A pending sign-in that expired has nothing left to continue, so it returns to the password step. */
function showError(error: unknown, fallback = 'auth.loginFailed') {
  const code = errorCode(error)
  if (code === 'no_pending_login') return backToPassword(t(errorKey(code)))
  errorMessage.value = t(errorKey(code, fallback))
}

/** What the account holder sees revoking this browser from settings; the server truncates it anyway. */
function deviceLabel(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent.slice(0, 80)
}

async function finish() {
  await refresh()
  await navigateTo(postLoginPath(me.value, route.query.next))
}

/** Finish with an answer that already carries the signed-in identity: the server's own value is used, and the
 * contract guarantees the shape before the page trusts it. */
async function finishWith(identity: unknown) {
  const answer = LoginVerifyResultSchema.parse(identity)
  await refresh()
  await navigateTo(postLoginPath(answer, route.query.next))
}

function backToPassword(message: string | null = null) {
  step.value = 'password'
  channels.value = null
  channel.value = null
  sent.value = null
  wait.value = null
  errorMessage.value = message
  state.password = ''
}

async function submit() {
  pending.value = true
  errorMessage.value = null
  try {
    const answer = LoginStepSchema.parse(await $fetch('/api/auth/login', {
      method: 'POST', body: { login: state.login, password: state.password },
    }))
    if (answer.ok) {
      await finish()
      return
    }
    // The password step named the account. A browser that is already remembered skips the code; anything else
    // (no cookie, or a device the account forgot) continues to the code step.
    const remembered = await rememberedDevice()
    if (remembered) {
      await finishWith(remembered)
      return
    }
    await openCodeStep()
  } catch (error) {
    showError(error)
  } finally {
    pending.value = false
  }
}

/** Whether this browser's remembered-device cookie finished the sign-in, with the identity it answered.
 *
 * The code step is the primary path and always works, so the device hop is only an optimisation: a refusal (no
 * cookie, a device the account forgot, an expired pre-session) and even a broken device route all fall through to
 * the code step, which then reports whatever is really wrong. Never throw here — a failure of the convenience path
 * must never lock a person out of the one that always works. */
async function rememberedDevice(): Promise<unknown | null> {
  try {
    return await $fetch('/api/auth/device', { method: 'POST', body: {} })
  } catch { return null }
}

// Ask where the code should go. An account with no usable channel is told so instead of being offered a send
// that cannot happen.
async function openCodeStep() {
  const answer = LoginChannelsSchema.parse(await $fetch('/api/auth/channels'))
  const first = preferredChannel(offeredChannels(answer))
  if (!first) return backToPassword(t('auth.channelUnavailable'))
  channels.value = answer
  channel.value = first
  sent.value = null
  wait.value = null
  step.value = 'code'
}

async function sendCode() {
  if (!channel.value) return
  pending.value = true
  errorMessage.value = null
  try {
    sent.value = await $fetch<LoginCodeSent>('/api/auth/code', { method: 'POST', body: { channel: channel.value } })
    wait.value = { seconds: sent.value.resend_after }
  } catch (error) {
    // A cooldown names the seconds the server still enforces; the countdown itself is the whole message, so no
    // second sentence repeats it. Any other refusal keeps its own sentence.
    const cooldown = errorCode(error) === 'resend_cooldown' ? errorSeconds(error) : 0
    if (cooldown) wait.value = { seconds: cooldown }
    else showError(error, 'errors.generic')
  } finally {
    pending.value = false
  }
}

function chooseChannel(next: LoginChannel) {
  if (next === channel.value) return
  channel.value = next
  sent.value = null
  wait.value = null
  errorMessage.value = null
}

async function verify(payload: { code: string; remember: boolean }) {
  pending.value = true
  errorMessage.value = null
  try {
    const answer = await $fetch('/api/auth/verify', {
      method: 'POST',
      body: payload.remember ? { code: payload.code, remember: true, label: deviceLabel() } : { code: payload.code },
    })
    await finishWith(answer)
  } catch (error) {
    showError(error, 'errors.generic')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <SharedStandalonePage surface="brand">
    <template #brand>
      <SharedBrandWordmark size="xl" inverted animated data-testid="login-brand" />
    </template>
    <template #header>
      <div class="flex flex-col items-center text-center">
        <img v-if="branding?.logo_url" :src="branding.logo_url" :alt="branding.name" class="mb-4 h-14 w-auto max-w-full object-contain" >
        <h1 class="text-2xl font-semibold text-highlighted" :class="{ 'sr-only': !branding?.name }">{{ productName }}</h1>
        <p class="text-sm text-muted">{{ headerHint }}</p>
      </div>
    </template>
    <UForm v-if="step === 'password'" novalidate :state="state" :validate="validate" class="liwan-form" @submit="submit">
      <UFormField :label="$t('auth.username')" name="login" required>
        <UInput id="login" v-model="state.login" autocomplete="username" dir="ltr" class="w-full text-start" />
      </UFormField>
      <UFormField :label="$t('auth.password')" name="password" required>
        <UInput id="password" v-model="state.password" type="password" autocomplete="current-password" dir="ltr" class="w-full" />
      </UFormField>
      <UAlert v-if="errorMessage" role="alert" color="error" variant="subtle" :title="errorMessage" />
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!hydrated" :loading="pending" :label="$t('auth.signIn')" />
      <UButton to="/forgot-password" color="neutral" variant="link" class="justify-center" :label="$t('auth.forgotPassword')" />
    </UForm>
    <LoginCodeStep
      v-else-if="channels" :channels="channels" :channel="channel" :sent="sent" :wait="wait" :pending="pending"
      :error="errorMessage" @select="chooseChannel" @send="sendCode" @verify="verify" @another="backToPassword()"
    />
  </SharedStandalonePage>
</template>
