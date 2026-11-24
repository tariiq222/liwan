<script setup lang="ts">
import type { SignupApp, SignupOffer } from '@/utils/subscription'
import type { FormError } from '@nuxt/ui'
import { ForgotPasswordInputSchema } from '@liwan/contracts'
import { errorCode, errorSeconds, normalizeCode } from '@/components/auth/loginFlow'
import { useResendWait } from '@/components/auth/useResendWait'
import { normalizeMobileInput } from '@/composables/useMe'
import { suggestWorkspaceSlug, workspaceSlugShapeOk } from '@/utils/workspaceSlug'

definePageMeta({ layout: false, access: 'public' })

type Step = 'details' | 'verify' | 'preparing'
type Action = 'terms' | 'offer' | 'check-slug' | 'start' | 'resend' | 'verify' | 'complete' | 'status'
type Channel = 'sms' | 'email'
type SlugState = 'idle' | 'checking' | 'available' | 'unavailable' | 'invalid'
type Preparing = 'preparing' | 'delayed' | 'failed' | 'ready'

const { t, locale, setLocale } = useI18n()
const otherLanguage = computed(() => locale.value === 'ar' ? { code: 'en', label: 'English' } as const : { code: 'ar', label: 'العربية' } as const)
const hydrated = useHydrated()
const step = ref<Step>('details')
const heading = ref<HTMLHeadingElement>()
const details = reactive({ company_name: '', admin_name: '', email: '', mobile: '', slug: '', accept_terms: false })
// The legal pages and terms version the vendor currently sets; the server refuses a start that does not echo this version.
type SignupConfig = { legal_base_url: string; terms_version: string; human_check?: { site_key: string; script_url: string } }
const legal = ref<SignupConfig>()
const offer = ref<SignupOffer>()
const offerLoading = ref(false)
const selectedApps = ref<SignupApp[]>(['crm', 'inbox'])
const monthlyMinor = computed(() => offer.value?.apps.reduce(
  (total, app) => total + (selectedApps.value.includes(app.id) ? app.monthly_minor : 0), 0,
) ?? 0)
const money = computed(() => new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'SAR' }))
const quantity = computed(() => new Intl.NumberFormat(locale.value))
const inboxLimits = ['inbox.channels', 'inbox.messages_out', 'inbox.campaign_recipients'] as const

function chooseApp(id: SignupApp, selected: boolean | 'indeterminate') {
  selectedApps.value = selected === true
    ? [...new Set([...selectedApps.value, id])]
    : selectedApps.value.filter(app => app !== id)
}
// The Turnstile token of the last completed check. It is single-use: every start request spends it, success or not.
const humanToken = ref<string>()
const widget = ref<{ reset: () => void }>()
const humanCheck = computed(() => legal.value?.human_check)
const checkReady = computed(() => !!legal.value && !!humanCheck.value && !!humanToken.value)
const widgetLanguage = computed(() => locale.value === 'en' ? 'en' : 'ar')
const legalPrefix = computed(() => locale.value === 'en' ? '/en' : '')
const termsUrl = computed(() => legal.value ? `${legal.value.legal_base_url}${legalPrefix.value}/terms` : undefined)
const privacyUrl = computed(() => legal.value ? `${legal.value.legal_base_url}${legalPrefix.value}/privacy` : undefined)
const signupId = ref<string>()
const codes = reactive<Record<Channel, string>>({ sms: '', email: '' })
const verified = reactive<Record<Channel, boolean>>({ sms: false, email: false })
const codeErrors = reactive<Record<Channel, string | undefined>>({ sms: undefined, email: undefined })
const waits: Record<Channel, ReturnType<typeof useResendWait>> = { sms: useResendWait(), email: useResendWait() }
const smsWait = waits.sms
const emailWait = waits.email
const pending = ref<string>()
const errorKey = ref<string>()
// The refusal the server states about the email field itself; its free-mail list stays on the server.
const emailErrorKey = ref<string>()
const resendCooldownSeconds = 60
const slugState = ref<SlugState>('idle')
// The suggestion follows the company name and email until the visitor types their own address.
const slugEdited = ref(false)
const preparing = ref<Preparing>('preparing')
const errors: Record<string, string> = {
  invalid: 'signup.errors.invalid',
  invalid_code: 'signup.errors.invalidCode',
  rate_limited: 'signup.errors.rateLimited',
  unavailable: 'signup.errors.unavailable',
  trial_already_used: 'signup.errors.trialAlreadyUsed',
  signup_expired: 'signup.errors.expired',
  terms_not_accepted: 'signup.errors.termsRequired',
  terms_changed: 'signup.errors.termsChanged',
  offer_changed: 'signup.errors.offerChanged',
  human_check_failed: 'signup.errors.humanCheckFailed',
  human_check_unavailable: 'signup.errors.humanCheckUnavailable',
  slug_taken: 'signup.errors.slugTaken',
  verification_incomplete: 'signup.errors.verificationIncomplete',
}

watch(step, () => { humanToken.value = undefined; heading.value?.focus() }, { flush: 'post' })
watch(() => details.email, () => { emailErrorKey.value = undefined })
watch(() => [details.company_name, details.email] as const, ([company, email]) => {
  if (!slugEdited.value) details.slug = suggestWorkspaceSlug(company, email)
})

let slugTimer: ReturnType<typeof setTimeout> | undefined
let slugRequest = 0
watch(() => details.slug, (value) => {
  clearTimeout(slugTimer)
  const slug = value.trim().toLowerCase()
  if (!slug) { slugState.value = 'idle'; return }
  if (!workspaceSlugShapeOk(slug)) { slugState.value = 'invalid'; return }
  slugState.value = 'checking'
  // The address is checked once typing pauses; only the answer to the latest request is shown.
  slugTimer = setTimeout(async () => {
    const mine = ++slugRequest
    try {
      const answer = await request<{ result: SlugState }>('check-slug', { slug })
      if (mine === slugRequest) slugState.value = answer.result
    } catch {
      if (mine === slugRequest) slugState.value = 'idle'
    }
  }, 400)
})

function editSlug(value: string | number) {
  slugEdited.value = true
  details.slug = String(value)
}

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
  if (!workspaceSlugShapeOk((value.slug ?? '').trim().toLowerCase())) problems.push({ name: 'slug', message: t('signup.errors.slugInvalid') })
  if (!value.accept_terms) problems.push({ name: 'accept_terms', message: t('signup.errors.termsRequired') })
  return problems
}

const slugMessage = computed(() => {
  if (slugState.value === 'available') return t('signup.slug.available')
  if (slugState.value === 'checking') return t('signup.slug.checking')
  return undefined
})
const slugError = computed(() => slugState.value === 'unavailable' ? t('signup.slug.unavailable') : slugState.value === 'invalid' ? t('signup.errors.slugInvalid') : undefined)

function resetVerification() {
  signupId.value = undefined
  codes.sms = ''
  codes.email = ''
  verified.sms = false
  verified.email = false
  codeErrors.sms = undefined
  codeErrors.email = undefined
  waits.sms.stop()
  waits.email.stop()
}

function editDetails() {
  resetVerification()
  errorKey.value = undefined
  emailErrorKey.value = undefined
  step.value = 'details'
}

function request<T>(action: Action, body: Record<string, string | boolean | SignupApp[]>) {
  return $fetch<T>(`/api/commercial/signup/${action}`, { method: 'POST', body })
}

async function loadTerms() {
  try { legal.value = await request<SignupConfig>('terms', {}) } catch { errorKey.value = errors.unavailable }
}

function spendHumanToken() {
  humanToken.value = undefined
  widget.value?.reset()
}
async function loadOffer() {
  offerLoading.value = true
  offer.value = undefined
  try {
    offer.value = await request<SignupOffer>('offer', {})
  } catch {
    errorKey.value = errors.unavailable
  } finally {
    offerLoading.value = false
  }
}

async function loadRegistration() {
  errorKey.value = undefined
  await Promise.all([loadTerms(), loadOffer()])
}

let pollTimer: ReturnType<typeof setTimeout> | undefined
let pollStartedAt = 0
onBeforeUnmount(() => { clearTimeout(pollTimer); clearTimeout(slugTimer) })

/** One status read. Resolves false when there is no signup to follow (no cookie, or it expired). */
async function readStatus(): Promise<boolean> {
  try {
    const answer = await request<{ state: Preparing; handoff_url?: string }>('status', {})
    preparing.value = answer.state
    if (answer.state === 'ready' && answer.handoff_url) {
      window.location.assign(answer.handoff_url)
      return true
    }
    if (answer.state === 'preparing' || answer.state === 'delayed') schedulePoll()
    return true
  } catch (error) {
    if (errorCode(error) === 'not_found') return false
    schedulePoll()
    return true
  }
}

function schedulePoll() {
  clearTimeout(pollTimer)
  // Every 3 seconds for the first two minutes, then every 10 seconds.
  const delay = Date.now() - pollStartedAt < 120_000 ? 3_000 : 10_000
  pollTimer = setTimeout(() => { void readStatus() }, delay)
}

function startPreparing() {
  step.value = 'preparing'
  preparing.value = 'preparing'
  pollStartedAt = Date.now()
  void readStatus()
}

onMounted(async () => {
  // A browser that already completed a signup in the last 24 hours resumes its waiting screen.
  pollStartedAt = Date.now()
  if (await readStatus()) { step.value = 'preparing'; return }
  await loadRegistration()
})

async function run(action: string, execute: () => Promise<void>) {
  if (!hydrated.value || pending.value) return
  pending.value = action
  errorKey.value = undefined
  emailErrorKey.value = undefined
  try {
    await execute()
  } catch (error) {
    const code = errorCode(error)
    if (code === 'signup_expired') editDetails()
    if (code === 'offer_changed') {
      editDetails()
      await loadOffer()
      if (offer.value) errorKey.value = errors.offer_changed
      return
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
    if (code === 'slug_taken') {
      // Someone took the address between the check and the reservation; both verifications stay, so only the address changes.
      step.value = 'details'
      slugState.value = 'unavailable'
      errorKey.value = errors.slug_taken
      return
    }
    errorKey.value = (code && Object.hasOwn(errors, code) ? errors[code] : undefined) ?? errors.unavailable
    throw error
  } finally {
    pending.value = undefined
  }
}

async function submitDetails() {
  // Back from the verification screen after a taken address: the codes are already confirmed, so only the address is reserved again.
  if (signupId.value && verified.sms && verified.email) { await complete(); return }
  const version = legal.value?.terms_version
  const token = humanToken.value
  const revision = offer.value?.offer_revision
  if (!revision || !selectedApps.value.length || !version || !details.accept_terms || !token || slugState.value === 'unavailable') return
  try {
    await run('start', async () => {
      const answer = await request<{ signup_id: string }>('start', {
        offer_revision: revision,
        app_ids: selectedApps.value,
        company_name: details.company_name.trim(),
        admin_name: details.admin_name.trim(),
        email: details.email.trim(),
        mobile: normalizeMobileInput(details.mobile),
        slug: details.slug.trim().toLowerCase(),
        accept_terms: true,
        terms_version: version,
        human_token: token,
      })
      if (!answer.signup_id) throw new Error('Missing signup ID')
      resetVerification()
      signupId.value = answer.signup_id
      waits.sms.start(resendCooldownSeconds)
      waits.email.start(resendCooldownSeconds)
      step.value = 'verify'
    })
  } catch { /* the refusal is shown by run */ } finally {
    spendHumanToken()
  }
}

async function resendCode(channel: Channel) {
  const id = signupId.value
  if (!id || waits[channel].waiting.value || verified[channel]) return
  try {
    await run(`resend-${channel}`, async () => {
      try {
        await request<{ ok: true }>('resend', { signup_id: id, channel })
        codes[channel] = ''
        waits[channel].start(resendCooldownSeconds)
      } catch (error) {
        if (errorCode(error) === 'rate_limited') waits[channel].start(errorSeconds(error) || resendCooldownSeconds)
        throw error
      }
    })
  } catch { /* shown by run */ }
}

async function verifyCode(channel: Channel) {
  const id = signupId.value
  const code = normalizeCode(codes[channel])
  codeErrors[channel] = undefined
  if (!id) return
  if (!code) { codeErrors[channel] = t('signup.errors.codeFormat'); return }
  try {
    await run(`verify-${channel}`, async () => {
      try {
        await request<{ ok: true }>('verify', { signup_id: id, channel, code })
        verified[channel] = true
        codes[channel] = ''
        waits[channel].stop()
      } catch (error) {
        if (errorCode(error) === 'invalid_code') { codeErrors[channel] = t('signup.errors.invalidCode'); errorKey.value = undefined; return }
        throw error
      }
    })
  } catch { /* shown by run */ }
}

async function complete() {
  const id = signupId.value
  if (!id || !verified.sms || !verified.email) return
  try {
    await run('complete', async () => {
      // After `slug_taken` the visitor picked another address on the details step; it goes with the completion.
      await request<{ ok: true }>('complete', { signup_id: id, slug: details.slug.trim().toLowerCase() })
      startPreparing()
    })
  } catch { /* shown by run */ }
}

const channels: Channel[] = ['sms', 'email']
const destination = (channel: Channel) => channel === 'sms' ? normalizeMobileInput(details.mobile) : details.email.trim()
const headingKey = computed(() => step.value === 'preparing' ? `signup.headings.${preparing.value}` : `signup.headings.${step.value}`)
</script>

<template>
  <SharedStandalonePage>
    <template #header>
      <div class="flex flex-col items-center gap-2 text-center">
        <SharedBrandWordmark size="md" />
        <UButton size="sm" color="neutral" variant="ghost" :lang="otherLanguage.code" :disabled="!hydrated" @click="setLocale(otherLanguage.code)">
          {{ otherLanguage.label }}
        </UButton>
        <p v-if="step !== 'preparing'" class="text-xs text-muted">{{ t(`signup.steps.${step}`) }}</p>
        <h1 ref="heading" tabindex="-1" class="font-display text-lg font-semibold text-highlighted">
          {{ t(headingKey) }}
        </h1>
        <p v-if="step === 'details'" class="text-sm text-muted">{{ t('signup.trial') }}</p>
      </div>
    </template>

    <div class="grid gap-4">
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="t(errorKey)" />

      <UForm v-if="step === 'details'" :state="details" :validate="validateDetails" novalidate class="liwan-form" @submit="submitDetails">
        <fieldset v-if="offer" class="grid gap-3">
          <legend class="mb-2 font-semibold text-highlighted">{{ t('signup.offer.title') }}</legend>
          <div v-for="app in offer.apps" :key="app.id" class="rounded-inner border border-default p-3">
            <UCheckbox :model-value="selectedApps.includes(app.id)" :disabled="!hydrated || !!pending"
              :label="t(`signup.offer.apps.${app.id}.name`)" @update:model-value="chooseApp(app.id, $event)" />
            <p class="mt-1 text-sm text-muted">{{ t(`signup.offer.apps.${app.id}.description`) }}</p>
            <p class="mt-1 text-sm">{{ t('signup.offer.month', { price: money.format(app.monthly_minor / 100) }) }}</p>
            <ul v-if="app.id === 'inbox'" class="mt-1 text-sm text-muted">
              <li v-for="(key, index) in inboxLimits" :key="key" v-show="Object.hasOwn(app.limits, key)">
                {{ t(`signup.offer.inboxLimits.${index}`, { count: app.limits[key] == null ? t('signup.offer.unlimited') : quantity.format(app.limits[key]!) }) }}
              </li>
            </ul>
          </div>
          <p class="text-sm text-muted">{{ t('signup.offer.base', {
            users: quantity.format(offer.included_users), storage: quantity.format(offer.included_storage_mb / 1024),
            branches: quantity.format(offer.included_extra_branches),
          }) }}</p>
          <p class="text-sm text-muted">{{ t('signup.offer.after') }}</p>
          <p role="status" class="font-semibold text-highlighted">{{ t('signup.offer.total', {
            today: money.format(0), monthly: money.format(monthlyMinor / 100),
          }) }}</p>
        </fieldset>
        <p v-else-if="offerLoading" role="status" class="text-sm text-muted">{{ t('signup.offer.loading') }}</p>
        <UButton v-if="!offerLoading && (!offer || !legal)" type="button" variant="outline" :label="t('signup.offer.retry')" @click="loadRegistration" />
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
        <UFormField name="slug" :label="t('signup.slug.label')" :help="slugMessage ?? t('signup.slug.help')" :error="slugError" required>
          <UInput
            id="slug" :model-value="details.slug" autocomplete="off" autocapitalize="off" spellcheck="false" dir="ltr" maxlength="30"
            class="w-full text-start" :disabled="!!pending" data-testid="workspace-slug" @update:model-value="editSlug"
          />
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
          v-if="humanCheck && !(signupId && verified.sms && verified.email)" ref="widget" :site-key="humanCheck.site_key" :script-url="humanCheck.script_url" :language="widgetLanguage"
          :label="t('signup.humanCheck')" @verified="humanToken = $event" @cleared="humanToken = undefined" @failed="errorKey = errors.human_check_unavailable"
        />
        <UButton
          type="submit" size="lg" class="w-full justify-center"
          :disabled="!hydrated || !!pending || !offer || !selectedApps.length || slugState === 'unavailable' || slugState === 'invalid' || (!(signupId && verified.sms && verified.email) && !checkReady)"
          :loading="pending === 'start' || pending === 'complete'" :label="t('signup.offer.begin')"
        />
      </UForm>

      <template v-else-if="step === 'verify'">
        <p class="text-sm text-muted">{{ t('signup.verifyIntro') }}</p>
        <div v-for="channel in channels" :key="channel" class="grid gap-2 rounded-inner border border-default p-3" :data-testid="`verify-${channel}`">
          <p class="text-sm">
            <i18n-t :keypath="`signup.sent.${channel}`" tag="span">
              <template #destination><bdi dir="ltr" class="wrap-anywhere">{{ destination(channel) }}</bdi></template>
            </i18n-t>
          </p>
          <p v-if="verified[channel]" role="status" class="flex items-center gap-2 text-sm text-success">
            <UIcon name="i-lucide-circle-check" class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ t(`signup.verified.${channel}`) }}</span>
          </p>
          <form v-else class="grid gap-2" novalidate @submit.prevent="verifyCode(channel)">
            <UFormField :name="`code-${channel}`" :label="t(`signup.codeLabel.${channel}`)" :error="codeErrors[channel]" required>
              <UInput :id="`code-${channel}`" v-model="codes[channel]" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" class="w-full text-start" :disabled="!!pending" />
            </UFormField>
            <div class="flex flex-wrap gap-2">
              <UButton type="submit" :disabled="!hydrated || !!pending" :loading="pending === `verify-${channel}`" :label="t('signup.verify')" />
              <UButton
                type="button" color="neutral" variant="outline" :disabled="!hydrated || !!pending || (channel === 'sms' ? smsWait.waiting.value : emailWait.waiting.value)"
                :loading="pending === `resend-${channel}`"
                :label="(channel === 'sms' ? smsWait.waiting.value : emailWait.waiting.value) ? t('signup.resendIn', { seconds: channel === 'sms' ? smsWait.seconds.value : emailWait.seconds.value }) : t('signup.resend')"
                @click="resendCode(channel)"
              />
            </div>
          </form>
        </div>
        <UButton
          type="button" size="lg" class="w-full justify-center" :disabled="!hydrated || !!pending || !verified.sms || !verified.email"
          :loading="pending === 'complete'" :label="t('signup.complete')" @click="complete"
        />
        <UButton type="button" color="neutral" variant="link" class="w-full justify-center" :disabled="!hydrated || !!pending" :label="t('signup.editDetails')" @click="editDetails" />
      </template>

      <template v-else>
        <div v-if="preparing === 'preparing' || preparing === 'ready'" role="status" class="flex items-center justify-center gap-3 text-sm text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <span>{{ t(preparing === 'ready' ? 'signup.preparing.ready' : 'signup.preparing.body') }}</span>
        </div>
        <UAlert v-else-if="preparing === 'delayed'" role="status" color="warning" variant="subtle" icon="i-lucide-clock" :title="t('signup.preparing.delayedTitle')" :description="t('signup.preparing.delayedBody')" />
        <UAlert v-else role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('signup.preparing.failedTitle')" :description="t('signup.preparing.failedBody')" />
        <p class="text-center text-sm text-muted">{{ t('signup.trialStarts') }}</p>
        <UButton v-if="preparing !== 'preparing'" to="/find-workspace" color="neutral" variant="link" class="justify-center" :label="t('signup.findLater')" />
      </template>
    </div>
  </SharedStandalonePage>
</template>
