<script setup lang="ts">
definePageMeta({ layout: false, access: 'public', middleware: 'customer-commercial' })

const MIN_LENGTH = 12
const { t } = useI18n()
const route = useRoute()
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const password = ref('')
const confirm = ref('')
const pending = ref(false)
// 'invalid' is one answer for an unknown, expired or already used link (the check cannot tell them apart, on purpose); it offers
// a new invitation and the sign-in routes. 'resend' is the same offer for someone who arrives without a link (from the sign-in page).
const state = ref<'checking' | 'form' | 'invalid' | 'resend' | 'accountUnavailable' | 'success'>(token.value ? 'checking' : 'resend')
// A valid token whose password was refused, whose acceptance is still running or whose service is
// unavailable keeps the form; the last two keep the typed password so the same button retries.
const formError = ref<'passwordRejected' | 'inProgress' | 'unavailable' | null>(null)
const login = ref<string | null>(null)
const hydrated = useHydrated()
const email = ref('')
const reissuePending = ref(false)
const reissueState = ref<'idle' | 'sent' | 'rateLimited' | 'unavailable'>('idle')
const emailOk = computed(() => /^[^\s@]+@[^\s@]+$/.test(email.value.trim()) && email.value.trim().length <= 254)
const canReissue = computed(() => emailOk.value && !reissuePending.value && hydrated.value)

const lengthOk = computed(() => password.value.length >= MIN_LENGTH)
const matchOk = computed(() => !!confirm.value && password.value === confirm.value)
const canSubmit = computed(() => lengthOk.value && matchOk.value && !pending.value && hydrated.value)
const loginHref = computed(() => (login.value ? { path: '/login', query: { login: login.value } } : '/login'))

// Learn before the password is typed whether the link is still usable; the answer is only yes/no.
// If the check itself fails, show the form anyway: accept still validates the token.
onMounted(async () => {
  if (state.value !== 'checking') return
  try {
    const res = await $fetch<{ usable: boolean }>('/api/invitations/check', { method: 'POST', body: { token: token.value } })
    state.value = res?.usable === true ? 'form' : 'invalid'
  } catch {
    state.value = 'form'
  }
})

// The answer is the same whether or not the address is waiting for an invitation, so the page never reveals which one it is.
async function requestNewInvitation() {
  if (!canReissue.value) return
  reissuePending.value = true
  try {
    await $fetch('/api/invitations/reissue', { method: 'POST', body: { email: email.value.trim() } })
    reissueState.value = 'sent'
  } catch (e: any) {
    const status = e?.statusCode ?? e?.status
    reissueState.value = status === 429 ? 'rateLimited' : 'unavailable'
  } finally {
    reissuePending.value = false
  }
}

async function submit() {
  if (!canSubmit.value) return
  pending.value = true
  formError.value = null
  let keepPassword = false
  try {
    const res = await $fetch<{ login: string | null }>('/api/invitations/accept', { method: 'POST', body: { token: token.value, password: password.value } })
    login.value = res?.login ?? null
    state.value = 'success'
  } catch (e: any) {
    const code = e?.data?.data?.code
    const status = e?.statusCode ?? e?.status
    if (code === 'password_rejected') formError.value = 'passwordRejected'
    else if (code === 'in_progress') { formError.value = 'inProgress'; keepPassword = true }
    else if (code === 'account_unavailable') state.value = 'accountUnavailable'
    else if (!status || status === 503) { formError.value = 'unavailable'; keepPassword = true }
    else state.value = 'invalid'
  } finally {
    if (!keepPassword) {
      password.value = ''
      confirm.value = ''
    }
    pending.value = false
  }
}
</script>

<template>
  <SharedStandalonePage :title="t('invite.title')">
    <p v-if="state === 'checking'" role="status" class="text-center text-sm text-muted">{{ t('invite.checking') }}</p>
    <form v-else-if="state === 'form'" class="liwan-form" @submit.prevent="submit">
      <p class="-mt-2 text-center text-sm text-muted">{{ t('invite.subtitle') }}</p>
      <UFormField :label="t('invite.password')" name="password" required>
        <UInput id="password" v-model="password" type="password" autocomplete="new-password" required dir="ltr" class="w-full" />
      </UFormField>
      <UFormField :label="t('invite.confirm')" name="confirm" required>
        <UInput id="confirm" v-model="confirm" type="password" autocomplete="new-password" required dir="ltr" class="w-full" />
      </UFormField>
      <div class="text-sm text-muted">
        <p class="font-medium">{{ t('invite.rulesTitle') }}</p>
        <ul class="mt-1 grid gap-1">
          <li :class="lengthOk ? 'text-success' : ''">{{ t('invite.ruleLength') }}</li>
          <li :class="matchOk ? 'text-success' : ''">{{ t('invite.ruleMatch') }}</li>
        </ul>
      </div>
      <UAlert v-if="formError" role="alert" :color="formError === 'unavailable' ? 'warning' : 'error'" variant="subtle" :icon="formError === 'unavailable' ? 'i-lucide-cloud-off' : 'i-lucide-circle-alert'" :title="t(`invite.${formError}Title`)" :description="t(`invite.${formError}Body`)" />
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!canSubmit" :loading="pending" :label="formError === 'unavailable' ? t('invite.retry') : t('invite.submit')" />
    </form>
    <div v-else-if="state === 'invalid' || state === 'resend'" class="grid gap-4">
      <UAlert v-if="state === 'invalid'" role="alert" color="warning" variant="subtle" icon="i-lucide-circle-alert" :title="t('invite.invalidTitle')" :description="t('invite.invalidBody')" />
      <p v-else class="text-center text-sm text-muted">{{ t('invite.resendSubtitle') }}</p>
      <UAlert v-if="reissueState === 'sent'" role="status" color="success" variant="subtle" icon="i-lucide-mail-check" :title="t('invite.resendSentTitle')" :description="t('invite.resendSentBody')" />
      <form v-else class="liwan-form" novalidate @submit.prevent="requestNewInvitation">
        <UFormField :label="t('invite.resendEmail')" name="email" :help="state === 'invalid' ? t('invite.resendHelp') : undefined" required>
          <UInput id="email" v-model="email" type="email" inputmode="email" autocomplete="email" dir="ltr" class="w-full text-start" />
        </UFormField>
        <UAlert v-if="reissueState === 'rateLimited' || reissueState === 'unavailable'" role="alert" color="warning" variant="subtle" icon="i-lucide-cloud-off" :title="t(`invite.resend${reissueState === 'rateLimited' ? 'RateLimited' : 'Unavailable'}Title`)" :description="t(`invite.resend${reissueState === 'rateLimited' ? 'RateLimited' : 'Unavailable'}Body`)" />
        <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!canReissue" :loading="reissuePending" :label="t('invite.resendSubmit')" />
      </form>
      <p class="text-center text-sm text-muted">{{ t('invite.alreadyActive') }}</p>
      <div class="grid gap-1">
        <UButton to="/login" color="neutral" variant="outline" size="lg" class="w-full justify-center" :label="t('invite.signIn')" />
        <UButton to="/forgot-password" color="neutral" variant="link" class="justify-center" :label="t('invite.forgotPassword')" />
      </div>
    </div>
    <UAlert v-else-if="state === 'accountUnavailable'" role="alert" color="error" variant="subtle" icon="i-lucide-user-x" :title="t('invite.accountUnavailableTitle')" :description="t('invite.accountUnavailableBody')" />
    <div v-else class="grid gap-4">
      <UAlert role="status" color="success" variant="subtle" icon="i-lucide-circle-check" :title="t('invite.successTitle')" :description="login ? t('invite.successLogin', { login }) : t('invite.successBody')" />
      <UButton :to="loginHref" size="lg" class="w-full justify-center" :label="t('invite.signIn')" />
    </div>
  </SharedStandalonePage>
</template>
