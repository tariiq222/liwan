<script setup lang="ts">
definePageMeta({ layout: false })

const MIN_LENGTH = 12
const { t } = useI18n()
const route = useRoute()
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const password = ref('')
const confirm = ref('')
const pending = ref(false)
const state = ref<'form' | 'invalid' | 'unavailable' | 'accountUnavailable' | 'success'>(token.value ? 'form' : 'invalid')
// A valid token whose password was refused or whose acceptance is still running keeps the form.
const formError = ref<'passwordRejected' | 'inProgress' | null>(null)
const login = ref<string | null>(null)
const hydrated = useHydrated()

const lengthOk = computed(() => password.value.length >= MIN_LENGTH)
const matchOk = computed(() => !!confirm.value && password.value === confirm.value)
const canSubmit = computed(() => lengthOk.value && matchOk.value && !pending.value && hydrated.value)
const loginHref = computed(() => (login.value ? { path: '/login', query: { login: login.value } } : '/login'))

async function submit() {
  if (!canSubmit.value) return
  pending.value = true
  formError.value = null
  try {
    const res = await $fetch<{ login: string | null }>('/api/invitations/accept', { method: 'POST', body: { token: token.value, password: password.value } })
    login.value = res?.login ?? null
    state.value = 'success'
  } catch (e: any) {
    const code = e?.data?.data?.code
    if (code === 'password_rejected') formError.value = 'passwordRejected'
    else if (code === 'in_progress') formError.value = 'inProgress'
    else if (code === 'account_unavailable') state.value = 'accountUnavailable'
    else state.value = (e?.statusCode ?? e?.status) === 503 ? 'unavailable' : 'invalid'
  } finally {
    password.value = ''
    confirm.value = ''
    pending.value = false
  }
}
</script>

<template>
  <SharedStandalonePage :title="t('invite.title')">
    <form v-if="state === 'form'" class="grid gap-4" @submit.prevent="submit">
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
      <UAlert v-if="formError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="formError === 'inProgress' ? t('invite.inProgressTitle') : t('invite.passwordRejectedTitle')" :description="formError === 'inProgress' ? t('invite.inProgressBody') : t('invite.passwordRejectedBody')" />
      <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!canSubmit" :loading="pending" :label="t('invite.submit')" />
    </form>
    <UAlert v-else-if="state === 'invalid'" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('invite.invalidTitle')" :description="t('invite.invalidBody')" />
    <UAlert v-else-if="state === 'accountUnavailable'" role="alert" color="error" variant="subtle" icon="i-lucide-user-x" :title="t('invite.accountUnavailableTitle')" :description="t('invite.accountUnavailableBody')" />
    <UAlert v-else-if="state === 'unavailable'" role="alert" color="warning" variant="subtle" icon="i-lucide-cloud-off" :title="t('invite.unavailableTitle')" :description="t('invite.unavailableBody')" />
    <div v-else class="grid gap-4">
      <UAlert role="status" color="success" variant="subtle" icon="i-lucide-circle-check" :title="t('invite.successTitle')" :description="login ? t('invite.successLogin', { login }) : t('invite.successBody')" />
      <UButton :to="loginHref" size="lg" class="w-full justify-center" :label="t('invite.signIn')" />
    </div>
  </SharedStandalonePage>
</template>
