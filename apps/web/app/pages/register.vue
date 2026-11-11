<script setup lang="ts">
import type { FormError } from '@nuxt/ui'
import { ForgotPasswordInputSchema } from '@liwan/contracts'
import { errorCode, errorSeconds, normalizeCode } from '@/components/auth/loginFlow'
import { useResendWait } from '@/components/auth/useResendWait'
import { normalizeMobileInput } from '@/composables/useMe'

definePageMeta({ layout: false, access: 'public' })

type Step = 'details' | 'sms' | 'email' | 'done'
type Action = 'start' | 'verify-sms' | 'send-email' | 'verify-email'

const { t, locale, setLocale } = useI18n()
const otherLanguage = computed(() => locale.value === 'ar' ? { code: 'en', label: 'English' } as const : { code: 'ar', label: 'العربية' } as const)
const hydrated = useHydrated()
const step = ref<Step>('details')
const heading = ref<HTMLHeadingElement>()
const details = reactive({ company_name: '', admin_name: '', email: '', mobile: '' })
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
}

watch(step, () => heading.value?.focus(), { flush: 'post' })
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

function request<T>(action: Action, body: Record<string, string>) {
  return $fetch<T>(`/api/commercial/signup/${action}`, { method: 'POST', body })
}

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
  if (waitingToResend.value) return
  await run('start', async () => {
    const answer = await request<{ signup_id: string }>('start', {
      company_name: details.company_name.trim(),
      admin_name: details.admin_name.trim(),
      email: details.email.trim(),
      mobile: normalizeMobileInput(details.mobile),
    })
    if (!answer.signup_id) throw new Error('Missing signup ID')
    signupId.value = answer.signup_id
    verification.code = ''
    resend.start(resendCooldownSeconds)
    step.value = 'sms'
  })
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
        <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!hydrated || !!pending" :loading="pending === 'start'" :label="t('signup.sendSms')" />
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
        <UButton
          type="button" color="neutral" variant="outline" size="lg" class="w-full justify-center"
          :disabled="!hydrated || !!pending || waitingToResend" :loading="pending === 'start' || pending === 'send-email'"
          :label="waitingToResend ? t('signup.resendIn', { seconds: resendSeconds }) : t(step === 'email' && !emailSent ? 'signup.sendEmail' : 'signup.resend')"
          @click="step === 'sms' ? startSignup() : sendEmail()"
        />
        <UButton
          type="button" color="neutral" variant="link" class="w-full justify-center"
          :disabled="!hydrated || !!pending" :label="t('signup.editDetails')" @click="editDetails"
        />
      </template>

      <UAlert v-else role="status" color="success" variant="subtle" icon="i-lucide-mail-check" :description="t('signup.invitation')" />
    </div>
  </SharedStandalonePage>
</template>
