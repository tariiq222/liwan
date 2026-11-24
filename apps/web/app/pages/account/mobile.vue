<script setup lang="ts">
import { MobileSchema } from '@liwan/contracts'
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
const codeRefusal = ref<'invalidCode' | 'codeExpired' | 'codeAttempts' | null>(null)
const failed = ref(false)
const signOutFailed = ref(false)
const resendIn = ref(0)
const hydrated = useHydrated()
let ticker: ReturnType<typeof setInterval> | undefined

const mobileValue = computed(() => normalizeMobileInput(mobile.value))
const mobileOk = computed(() => MobileSchema.safeParse(mobileValue.value).success)
const mobileError = computed(() => refusal.value ?? (mobile.value.trim() && !mobileOk.value ? 'mobileInvalid' : null))
const codeOk = computed(() => /^[0-9]{6}$/.test(code.value.trim()))
const canSubmit = computed(() => (step.value === 'number' ? mobileOk.value : codeOk.value) && !pending.value && hydrated.value)

function countDown(seconds: number) {
  resendIn.value = seconds
  clearInterval(ticker)
  ticker = setInterval(() => {
    resendIn.value -= 1
    if (resendIn.value <= 0) clearInterval(ticker)
  }, 1000)
}

onBeforeUnmount(() => clearInterval(ticker))

function refusalOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

async function send() {
  if (!canSubmit.value) return
  pending.value = true
  refusal.value = null
  failed.value = false
  try {
    await requestCode(mobileValue.value)
    step.value = 'code'
    code.value = ''
    codeRefusal.value = null
    countDown(60)
  } catch (error) {
    const code = refusalOf(error)
    if (code === 'invalid_mobile') refusal.value = 'mobileInvalid'
    else if (code === 'mobile_taken') refusal.value = 'mobileTaken'
    else failed.value = true
  } finally {
    pending.value = false
  }
}

async function verify() {
  if (!canSubmit.value) return
  pending.value = true
  codeRefusal.value = null
  failed.value = false
  const wasRequired = required.value
  try {
    await verifyCode(code.value.trim())
    if (!wasRequired) toast.add({ title: t('accountLink.mobileStep.verified'), color: 'success' })
    await navigateTo(wasRequired ? postLoginPath(me.value, route.query.next) : '/account/settings')
  } catch (error) {
    const refusalCode = refusalOf(error)
    if (refusalCode === 'invalid_code') codeRefusal.value = 'invalidCode'
    else if (refusalCode === 'code_expired') codeRefusal.value = 'codeExpired'
    else if (refusalCode === 'too_many_attempts') codeRefusal.value = 'codeAttempts'
    else failed.value = true
  } finally {
    pending.value = false
  }
}

function backToNumber() {
  clearInterval(ticker)
  resendIn.value = 0
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
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!canSubmit" :loading="pending" :label="t('accountLink.mobileStep.sendCode')" />
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
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!canSubmit" :loading="pending" :label="t('accountLink.mobileStep.verify')" />
      <UButton type="button" color="neutral" variant="outline" class="w-full justify-center" :disabled="resendIn > 0 || pending || !hydrated" :label="resendIn > 0 ? t('accountLink.mobileStep.resendIn', { seconds: resendIn }) : t('accountLink.mobileStep.resend')" @click="send" />
      <UButton type="button" color="neutral" variant="link" class="justify-center" :disabled="!hydrated" :label="t('accountLink.mobileStep.changeNumber')" @click="backToNumber" />
    </form>
  </SharedStandalonePage>
</template>
