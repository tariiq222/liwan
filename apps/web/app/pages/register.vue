<script setup lang="ts">
import type { FormError } from '@nuxt/ui'
import { ForgotPasswordInputSchema } from '@liwan/contracts'
import { errorCode, errorSeconds, normalizeCode } from '@/components/auth/loginFlow'
import { useResendWait } from '@/components/auth/useResendWait'
import { normalizeMobileInput } from '@/composables/useMe'

definePageMeta({ layout: false, access: 'public' })

type Step = 'details' | 'sms' | 'email' | 'done'
type Action = 'terms' | 'start' | 'verify-sms' | 'send-email' | 'verify-email'

const { t, locale, setLocale } = useI18n()
const otherLanguage = computed(() => locale.value === 'ar' ? { code: 'en', label: 'English' } as const : { code: 'ar', label: 'العربية' } as const)
const hydrated = useHydrated()
const step = ref<Step>('details')
const heading = ref<HTMLHeadingElement>()
const details = reactive({ company_name: '', admin_name: '', email: '', mobile: '', accept_terms: false })
// The legal pages and terms version the vendor currently sets; the server refuses a start that does not echo this version.
type SignupConfig = { legal_base_url: string; terms_version: string; human_check?: { site_key: string; script_url: string } }
const legal = ref<SignupConfig>()
// The Turnstile token of the last completed check. It is single-use: every start request spends it, success or not.
const humanToken = ref<string>()
const widget = ref<{ reset: () => void }>()
const humanCheck = computed(() => legal.value?.human_check)
const checkReady = computed(() => !!legal.value && !!humanCheck.value && !!humanToken.value)
const widgetLanguage = computed(() => locale.value === 'en' ? 'en' : 'ar')
const legalPrefix = computed(() => locale.value === 'en' ? '/en' : '')
const termsUrl = computed(() => legal.value ? `${legal.value.legal_base_url}${legalPrefix.value}/terms` : undefined)
const privacyUrl = computed(() => legal.value ? `${legal.value.legal_base_url}${legalPrefix.value}/privacy` : undefined)
const verification = reactive({ code: '' })
const signupId = ref<string>()
const emailSent = ref(false)
const pending = ref<Action>()
const errorKey = ref<string>()
// The refusal the server states about the email field itself; its free-mail list stays on the server.
const emailErrorKey = ref<string>()
const resend = useResendWait()
const resendSeconds = resend.seconds
const waitingToResend = resend.waiting
const resendCooldownSeconds = 60
const errors: Record<string, string> = {
  invalid: 'signup.errors.invalid',
  invalid_code: 'signup.errors.invalidCode',
  rate_limited: 'signup.errors.rateLimited',
  unavailable: 'signup.errors.unavailable',
  trial_already_used: 'signup.errors.trialAlreadyUsed',
  signup_expired: 'signup.errors.expired',
  terms_not_accepted: 'signup.errors.termsRequired',
  terms_changed: 'signup.errors.termsChanged',
  human_check_failed: 'signup.errors.humanCheckFailed',
  human_check_unavailable: 'signup.errors.humanCheckUnavailable',
}

watch(step, () => { humanToken.value = undefined; heading.value?.focus() }, { flush: 'post' })
watch(() => details.email, () => { emailErrorKey.value = undefined })

function validateDetails(value: Partial<typeof details>): FormError[] {
  const problems: FormError[] = []
  if (!value.company_name?.trim()) problems.push({ name: 'company_name', message: t('signup.errors.companyRequired') })
  if (!value.admin_name?.trim()) problems.push({ name: 'admin_name', message: t('signup.errors.adminRequired') })
  if (!ForgotPasswordInputSchema.safeParse({ email: value.email }).success) {
    problems.push({ name: 'email', message: t('signup.errors.emailInvalid') })
  }
  if (!/^\+9665[0-9]{8}$/.test(normalizeMobileInput(value.mobile ?? ''))) {
    problems.push({ name: 'mobile', message: t('signup.errors.mobileInvalid') })
  }
  if (!value.accept_terms) problems.push({ name: 'accept_terms', message: t('signup.errors.termsRequired') })
  return problems
}

function validateCode(value: Partial<typeof verification>): FormError[] {
  return normalizeCode(value.code ?? '') ? [] : [{ name: 'code', message: t('signup.errors.codeFormat') }]
}

function editDetails() {
  signupId.value = undefined
  emailSent.value = false
  verification.code = ''
  errorKey.value = undefined
  emailErrorKey.value = undefined
  resend.stop()
  step.value = 'details'
}

function request<T>(action: Action, body: Record<string, string | boolean>) {
  return $fetch<T>(`/api/commercial/signup/${action}`, { method: 'POST', body })
}

async function loadTerms() {
  try { legal.value = await request<SignupConfig>('terms', {}) } catch { errorKey.value = errors.unavailable }
}

function spendHumanToken() {
  humanToken.value = undefined
  widget.value?.reset()
}
onMounted(loadTerms)

async function run(action: Action, execute: () => Promise<void>) {
  if (!hydrated.value || pending.value) return
  pending.value = action
  errorKey.value = undefined
  emailErrorKey.value = undefined
  try {
    await execute()
  } catch (error) {
    const code = errorCode(error)
    if (code === 'signup_expired') editDetails()
    if (code === 'rate_limited' && (action === 'start' || action === 'send-email') && step.value !== 'details') {
      resend.start(errorSeconds(error) || resendCooldownSeconds)
    }
    if (code === 'terms_changed') {
      // The vendor published new terms while the form was open: show the new links and ask for a fresh acceptance.
      editDetails()
      details.accept_terms = false
      await loadTerms()
      errorKey.value = errors.terms_changed
      return
    }
    if (code === 'business_email_required') {
      emailErrorKey.value = 'signup.errors.businessEmailRequired'
      return
    }
    errorKey.value = (code && Object.hasOwn(errors, code) ? errors[code] : undefined) ?? errors.unavailable
  } finally {
    pending.value = undefined
  }
}

async function startSignup() {
  const version = legal.value?.terms_version
  const token = humanToken.value
  if (waitingToResend.value || !version || !details.accept_terms || !token) return
  try {
    await run('start', async () => {
      const answer = await request<{ signup_id: string }>('start', {
        company_name: details.company_name.trim(),
        admin_name: details.admin_name.trim(),
        email: details.email.trim(),
        mobile: normalizeMobileInput(details.mobile),
        accept_terms: true,
        terms_version: version,
        human_token: token,
      })
      if (!answer.signup_id) throw new Error('Missing signup ID')
      signupId.value = answer.signup_id
      verification.code = ''
      resend.start(resendCooldownSeconds)
      step.value = 'sms'
    })
  } finally {
    spendHumanToken()
  }
}

async function sendEmail() {
  const id = signupId.value
  if (!id || waitingToResend.value) return
  await run('send-email', async () => {
    const answer = await request<{ ok: true }>('send-email', { signup_id: id })
    if (!answer.ok) throw new Error('Missing email confirmation')
    emailSent.value = true
    verification.code = ''
    resend.start(resendCooldownSeconds)
  })
}

async function verifyCode() {
  const id = signupId.value
  const code = normalizeCode(verification.code)
  if (!id || !code || (step.value !== 'sms' && step.value !== 'email')) return
  const action = step.value === 'sms' ? 'verify-sms' : 'verify-email'
  await run(action, async () => {
    const answer = await request<{ ok: true }>(action, { signup_id: id, code })
    if (!answer.ok) throw new Error('Missing verification confirmation')
    verification.code = ''
    resend.stop()
    if (action === 'verify-sms') {
      step.value = 'email'
    } else {
      signupId.value = undefined
      details.company_name = ''
      details.admin_name = ''
      details.email = ''
      details.mobile = ''
      details.accept_terms = false
      step.value = 'done'
    }
  })
  if (action === 'verify-sms' && step.value === 'email' && !emailSent.value && !errorKey.value) await sendEmail()
}
</script>

<template>
  <SharedStandalonePage>
    <template #header>
      <div class="flex flex-col items-center gap-2 text-center">
        <SharedBrandWordmark size="md" />
        <UButton size="sm" color="neutral" variant="ghost" :lang="otherLanguage.code" :disabled="!hydrated" @click="setLocale(otherLanguage.code)">
          {{ otherLanguage.label }}
        </UButton>
        <p v-if="step !== 'done'" class="text-xs text-muted">{{ t(`signup.steps.${step}`) }}</p>
        <h1 ref="heading" tabindex="-1" class="font-display text-lg font-semibold text-highlighted">
          {{ t(`signup.headings.${step}`) }}
        </h1>
        <p v-if="step === 'details'" class="text-sm text-muted">{{ t('signup.trial') }}</p>
      </div>
    </template>

    <div class="grid gap-4">
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="t(errorKey)" />

      <UForm v-if="step === 'details'" :state="details" :validate="validateDetails" novalidate class="liwan-form" @submit="startSignup">
        <UFormField name="company_name" :label="t('signup.companyName')" required>
          <UInput v-model="details.company_name" autocomplete="organization" class="w-full" :disabled="!!pending" />
        </UFormField>
        <UFormField name="admin_name" :label="t('signup.adminName')" required>
          <UInput v-model="details.admin_name" autocomplete="name" class="w-full" :disabled="!!pending" />
        </UFormField>
        <UFormField name="email" :label="t('signup.email')" :error="emailErrorKey ? t(emailErrorKey) : undefined" required>
          <UInput v-model="details.email" type="email" autocomplete="email" dir="ltr" class="w-full text-start" :disabled="!!pending" />
        </UFormField>
        <UFormField name="mobile" :label="t('signup.mobile')" required>
          <UInput v-model="details.mobile" type="tel" autocomplete="tel" dir="ltr" class="w-full text-start" :disabled="!!pending" />
        </UFormField>
        <UFormField name="accept_terms">
          <UCheckbox v-model="details.accept_terms" :disabled="!!pending || !legal" data-testid="accept-terms">
            <template #label>
              <i18n-t keypath="signup.acceptTerms" tag="span">
                <template #terms><a :href="termsUrl" target="_blank" rel="noopener" class="text-primary underline">{{ t('signup.termsLink') }}</a></template>
                <template #privacy><a :href="privacyUrl" target="_blank" rel="noopener" class="text-primary underline">{{ t('signup.privacyLink') }}</a></template>
              </i18n-t>
            </template>
          </UCheckbox>
        </UFormField>
        <AuthTurnstileWidget
          v-if="humanCheck" ref="widget" :site-key="humanCheck.site_key" :script-url="humanCheck.script_url" :language="widgetLanguage"
          :label="t('signup.humanCheck')" @verified="humanToken = $event" @cleared="humanToken = undefined" @failed="errorKey = errors.human_check_unavailable"
        />
        <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!hydrated || !!pending || !checkReady" :loading="pending === 'start'" :label="t('signup.sendSms')" />
      </UForm>

      <template v-else-if="step === 'sms' || step === 'email'">
        <p v-if="step === 'sms'" class="text-sm text-muted">
          <i18n-t keypath="signup.smsSent" tag="span">
            <template #destination><bdi dir="ltr">{{ normalizeMobileInput(details.mobile) }}</bdi></template>
          </i18n-t>
        </p>
        <p v-else class="text-sm text-muted" role="status">
          <i18n-t :keypath="emailSent ? 'signup.emailSent' : 'signup.emailDestination'" tag="span">
            <template #destination><bdi dir="ltr" class="wrap-anywhere">{{ details.email.trim() }}</bdi></template>
          </i18n-t>
        </p>

        <UForm :key="step" :state="verification" :validate="validateCode" novalidate class="liwan-form" @submit="verifyCode">
          <UFormField name="code" :label="t('signup.code')" required>
            <UInput v-model="verification.code" inputmode="numeric" autocomplete="one-time-code" dir="ltr" class="w-full text-start" :disabled="!!pending" />
          </UFormField>
          <UButton
            type="submit" size="lg" class="w-full justify-center"
            :disabled="!hydrated || !!pending" :loading="pending === 'verify-sms' || pending === 'verify-email'"
            :label="t('signup.verify')"
          />
        </UForm>
        <AuthTurnstileWidget
          v-if="step === 'sms' && humanCheck" ref="widget" :site-key="humanCheck.site_key" :script-url="humanCheck.script_url" :language="widgetLanguage"
          :label="t('signup.humanCheck')" @verified="humanToken = $event" @cleared="humanToken = undefined" @failed="errorKey = errors.human_check_unavailable"
        />
        <UButton
          type="button" color="neutral" variant="outline" size="lg" class="w-full justify-center"
          :disabled="!hydrated || !!pending || waitingToResend || (step === 'sms' && !checkReady)" :loading="pending === 'start' || pending === 'send-email'"
          :label="waitingToResend ? t('signup.resendIn', { seconds: resendSeconds }) : t(step === 'email' && !emailSent ? 'signup.sendEmail' : 'signup.resend')"
          @click="step === 'sms' ? startSignup() : sendEmail()"
        />
        <UButton
          type="button" color="neutral" variant="link" class="w-full justify-center"
          :disabled="!hydrated || !!pending" :label="t('signup.editDetails')" @click="editDetails"
        />
      </template>

      <UAlert
        v-else role="status" color="success" variant="subtle" icon="i-lucide-mail-check"
        :description="`${t('signup.invitation', { email: details.email.trim() })} ${t('signup.invitationLate')}`"
      />
      <UButton v-if="step === 'done'" to="/find-workspace" color="neutral" variant="link" class="justify-center" :label="t('signup.findLater')" />
    </div>
  </SharedStandalonePage>
</template>
