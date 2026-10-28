<script setup lang="ts">
definePageMeta({ layout: false, access: 'public' })

const MIN_LENGTH = 12
const { t } = useI18n()
const route = useRoute()
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const password = ref('')
const confirm = ref('')
const pending = ref(false)
const state = ref<'checking' | 'form' | 'invalid' | 'accountUnavailable' | 'success'>(token.value ? 'checking' : 'invalid')
// A valid token whose password was refused, whose acceptance is still running or whose service is
// unavailable keeps the form; the last two keep the typed password so the same button retries.
const formError = ref<'passwordRejected' | 'inProgress' | 'unavailable' | null>(null)
const login = ref<string | null>(null)
const hydrated = useHydrated()

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
    <form v-else-if="state === 'form'" class="grid gap-4" @submit.prevent="submit">
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
    <UAlert v-else-if="state === 'invalid'" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('invite.invalidTitle')" :description="t('invite.invalidBody')" />
    <UAlert v-else-if="state === 'accountUnavailable'" role="alert" color="error" variant="subtle" icon="i-lucide-user-x" :title="t('invite.accountUnavailableTitle')" :description="t('invite.accountUnavailableBody')" />
    <div v-else class="grid gap-4">
      <UAlert role="status" color="success" variant="subtle" icon="i-lucide-circle-check" :title="t('invite.successTitle')" :description="login ? t('invite.successLogin', { login }) : t('invite.successBody')" />
      <UButton :to="loginHref" size="lg" class="w-full justify-center" :label="t('invite.signIn')" />
    </div>
  </SharedStandalonePage>
</template>
