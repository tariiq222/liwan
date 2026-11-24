<script setup lang="ts">
import { MobileSchema } from '@liwan/contracts'
import { errorSeconds, normalizeCode } from '@/components/auth/loginFlow'
import { ApiError } from '@/composables/useApi'
import { normalizeMobileInput, useRequestMobileCode, useVerifyMobileCode } from '@/composables/useMe'
import { useSignOut } from '@/composables/useSignOut'
import { postLoginPath } from '~/utils/accessPolicy'

// The mobile step in two parts: the holder types the number, receives its own code, and only that code verifies it.
// While the server says a verified number is required this is the only page (besides sign-out) that opens; afterwards
// it is where the holder replaces the number.
definePageMeta({ layout: false })

const { t } = useI18n()
const route = useRoute()
const toast = useToast()
const { me } = useMe()
const requestCode = useRequestMobileCode()
const verifyCode = useVerifyMobileCode()
const signOutOfSession = useSignOut()
const required = computed(() => me.value?.mobile_required === true)
const step = ref<'number' | 'code'>('number')
const mobile = ref(me.value?.mobile ?? '')
const code = ref('')
const pending = ref(false)
const refusal = ref<'mobileInvalid' | 'mobileTaken' | null>(null)
const sendRefusal = ref<'cooldown' | 'sendLimitReached' | 'dailySendCap' | 'channelUnavailable' | null>(null)
const codeRefusal = ref<'invalidCode' | null>(null)
const failed = ref(false)
const signOutFailed = ref(false)
const resendIn = ref(0)
const hydrated = useHydrated()
let ticker: ReturnType<typeof setInterval> | undefined

// The window the button counts down after an accepted send; a refusal names its own wait instead.
const RESEND_SECONDS = 60

const mobileValue = computed(() => normalizeMobileInput(mobile.value))
const mobileOk = computed(() => MobileSchema.safeParse(mobileValue.value).success)
const mobileError = computed(() => refusal.value ?? (mobile.value.trim() && !mobileOk.value ? 'mobileInvalid' : null))
// Arabic-Indic digits from a phone keyboard are codes too: the shared normalizer is what the sign-in step trusts.
const codeDigits = computed(() => normalizeCode(code.value))
// A cooldown answer holds the send button for the seconds the server named, on whichever step it came from.
const sendWaiting = computed(() => resendIn.value > 0)
const canSend = computed(() => mobileOk.value && !pending.value && !sendWaiting.value && hydrated.value)
const canVerify = computed(() => codeDigits.value !== null && !pending.value && hydrated.value)

/** The sentence of a refused send: the cooldown's own countdown, else the refusal's own text. */
const sendRefusalText = computed(() => (sendRefusal.value === 'cooldown'
  ? t('accountLink.mobileStep.resendIn', { seconds: resendIn.value })
  : sendRefusal.value ? t(`accountLink.mobileStep.${sendRefusal.value}`) : undefined))

function countDown(seconds: number) {
  resendIn.value = seconds
  clearInterval(ticker)
  ticker = setInterval(() => {
    resendIn.value -= 1
    if (resendIn.value <= 0) {
      clearInterval(ticker)
      if (sendRefusal.value === 'cooldown') sendRefusal.value = null
    }
  }, 1000)
}

onBeforeUnmount(() => clearInterval(ticker))

function refusalOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

/** The seconds a refusal asks the page to wait: `ApiError` keeps `details`, a raw envelope nests them further in. */
function waitOf(error: unknown): number {
  const fromApi = error instanceof ApiError ? Number(error.details?.resend_after ?? 0) : 0
  return Number.isFinite(fromApi) && fromApi > 0 ? Math.ceil(fromApi) : errorSeconds(error)
}

async function send() {
  if (!canSend.value) return
  pending.value = true
  refusal.value = null
  sendRefusal.value = null
  failed.value = false
  try {
    await requestCode(mobileValue.value)
    step.value = 'code'
    code.value = ''
    codeRefusal.value = null
    countDown(RESEND_SECONDS)
  } catch (error) {
    const code = refusalOf(error)
    if (code === 'invalid_mobile') refusal.value = 'mobileInvalid'
    else if (code === 'mobile_taken') refusal.value = 'mobileTaken'
    else if (code === 'resend_cooldown') {
      sendRefusal.value = 'cooldown'
      countDown(waitOf(error) || RESEND_SECONDS)
    }
    else if (code === 'send_limit_reached') sendRefusal.value = 'sendLimitReached'
    else if (code === 'daily_send_cap') sendRefusal.value = 'dailySendCap'
    else if (code === 'channel_unavailable') sendRefusal.value = 'channelUnavailable'
    else failed.value = true
  } finally {
    pending.value = false
  }
}

async function verify() {
  if (!canVerify.value || !codeDigits.value) return
  pending.value = true
  codeRefusal.value = null
  failed.value = false
  const wasRequired = required.value
  try {
    await verifyCode(codeDigits.value)
    if (!wasRequired) toast.add({ title: t('accountLink.mobileStep.verified'), color: 'success' })
    await navigateTo(wasRequired ? postLoginPath(me.value, route.query.next) : '/account/settings')
  } catch (error) {
    // The server answers one refusal for a wrong, an expired and a burned code alike: the sentence tells the user
    // what to do about either, since the step itself cannot tell them apart.
    if (refusalOf(error) === 'invalid_code') codeRefusal.value = 'invalidCode'
    else failed.value = true
  } finally {
    pending.value = false
  }
}

function backToNumber() {
  clearInterval(ticker)
  resendIn.value = 0
  sendRefusal.value = null
  code.value = ''
  codeRefusal.value = null
  step.value = 'number'
}

// Sign-out stays reachable here: it is one of the few routes that answers while the number is missing.
async function signOut() {
  signOutFailed.value = false
  signOutFailed.value = !(await signOutOfSession())
}
</script>

<template>
  <SharedStandalonePage :title="required ? t('accountLink.mobileStep.title') : t('accountLink.mobileStep.titleChange')">
    <form v-if="step === 'number'" class="liwan-form" novalidate @submit.prevent="send">
      <p class="-mt-2 text-center text-sm text-muted">{{ t('accountLink.mobileStep.subtitle') }}</p>
      <UFormField :label="t('accountLink.mobileLabel')" name="mobile" :help="t('accountLink.mobileHint')" :error="mobileError ? t(`accountLink.${mobileError}`) : undefined" required>
        <UInput id="mobile" v-model="mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="+966 5X XXX XXXX" dir="ltr" class="w-full text-start" :disabled="!hydrated" />
      </UFormField>
      <UAlert v-if="failed" role="alert" color="warning" variant="subtle" icon="i-lucide-cloud-off" :title="t('accountLink.unavailableTitle')" :description="t('accountLink.unavailableBody')" />
      <UAlert v-else-if="sendRefusal" role="alert" color="warning" variant="subtle" icon="i-lucide-clock" :title="sendRefusalText" />
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!canSend" :loading="pending" :label="t('accountLink.mobileStep.sendCode')" />
      <UButton v-if="required" type="button" color="neutral" variant="link" class="justify-center" :disabled="!hydrated" :label="t('accountLink.mobileStep.signOut')" @click="signOut" />
      <UButton v-else to="/account/settings" color="neutral" variant="link" class="justify-center" :label="t('accountLink.mobileStep.back')" />
      <UAlert v-if="signOutFailed" role="alert" color="error" variant="subtle" :title="t('accountLink.mobileStep.signOutFailed')" />
    </form>
    <form v-else class="liwan-form" novalidate @submit.prevent="verify">
      <p class="-mt-2 text-center text-sm text-muted">{{ t('accountLink.mobileStep.codeSubtitle', { mobile: mobileValue }) }}</p>
      <UFormField :label="t('accountLink.mobileStep.codeLabel')" name="code" :error="codeRefusal ? t(`accountLink.mobileStep.${codeRefusal}`) : undefined" required>
        <UInput id="mobile-code" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" class="w-full text-center tracking-widest" :disabled="!hydrated" />
      </UFormField>
      <p class="text-center text-sm text-muted">{{ t('accountLink.mobileStep.codeValidity') }}</p>
      <UAlert v-if="failed" role="alert" color="warning" variant="subtle" icon="i-lucide-cloud-off" :title="t('accountLink.unavailableTitle')" :description="t('accountLink.unavailableBody')" />
      <UAlert v-else-if="sendRefusal && sendRefusal !== 'cooldown'" role="alert" color="warning" variant="subtle" icon="i-lucide-clock" :title="sendRefusalText" />
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!canVerify" :loading="pending" :label="t('accountLink.mobileStep.verify')" />
      <UButton type="button" color="neutral" variant="outline" class="w-full justify-center" :disabled="resendIn > 0 || pending || !hydrated" :label="resendIn > 0 ? t('accountLink.mobileStep.resendIn', { seconds: resendIn }) : t('accountLink.mobileStep.resend')" @click="send" />
      <UButton type="button" color="neutral" variant="link" class="justify-center" :disabled="!hydrated" :label="t('accountLink.mobileStep.changeNumber')" @click="backToNumber" />
    </form>
  </SharedStandalonePage>
</template>
