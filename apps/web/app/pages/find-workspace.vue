<script setup lang="ts">
import type { FormError } from '@nuxt/ui'
import { ForgotPasswordInputSchema } from '@liwan/contracts'
import { errorCode } from '@/components/auth/loginFlow'

definePageMeta({ layout: false, access: 'public' })

// The common host's way in for a manager who lost the address of their workspace. The answer is the same sentence whether or not
// the address manages one; the control plane mails the address it holds on record, and only after the human check passed.
type HumanCheckConfig = { human_check?: { site_key: string; script_url: string } }

const { t, locale, setLocale } = useI18n()
const otherLanguage = computed(() => locale.value === 'ar' ? { code: 'en', label: 'English' } as const : { code: 'ar', label: 'العربية' } as const)
const hydrated = useHydrated()
const state = reactive({ email: '' })
const config = ref<HumanCheckConfig>()
// The Turnstile token of the last completed check. It is single-use: every request spends it, success or not.
const humanToken = ref<string>()
const widget = ref<{ reset: () => void }>()
const humanCheck = computed(() => config.value?.human_check)
const checkReady = computed(() => !!humanCheck.value && !!humanToken.value)
const widgetLanguage = computed(() => locale.value === 'en' ? 'en' : 'ar')
const pending = ref(false)
const sent = ref(false)
const errorKey = ref<string>()
const errors: Record<string, string> = {
  invalid: 'findWorkspace.errors.invalid',
  rate_limited: 'findWorkspace.errors.rateLimited',
  unavailable: 'findWorkspace.errors.unavailable',
  human_check_failed: 'findWorkspace.errors.humanCheckFailed',
  human_check_unavailable: 'findWorkspace.errors.humanCheckUnavailable',
}

function validate(value: Partial<typeof state>): FormError[] {
  return ForgotPasswordInputSchema.safeParse({ email: value.email }).success ? [] : [{ name: 'email', message: t('findWorkspace.errors.emailInvalid') }]
}

function spendHumanToken() {
  humanToken.value = undefined
  widget.value?.reset()
}

async function loadHumanCheck() {
  try { config.value = await $fetch<HumanCheckConfig>('/api/commercial/signup/terms', { method: 'POST', body: {} }) } catch { errorKey.value = errors.unavailable }
}
onMounted(loadHumanCheck)

async function submit() {
  const token = humanToken.value
  if (!hydrated.value || pending.value || !token) return
  pending.value = true
  errorKey.value = undefined
  try {
    await $fetch('/api/invitations/find-workspace', { method: 'POST', body: { email: state.email.trim(), human_token: token } })
    sent.value = true
  } catch (error) {
    const code = errorCode(error)
    errorKey.value = (code && Object.hasOwn(errors, code) ? errors[code] : undefined) ?? errors.unavailable
  } finally {
    pending.value = false
    spendHumanToken()
  }
}

function another() {
  sent.value = false
  state.email = ''
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
        <h1 class="font-display text-lg font-semibold text-highlighted">{{ t('findWorkspace.title') }}</h1>
        <p v-if="!sent" class="text-sm text-muted">{{ t('findWorkspace.intro') }}</p>
      </div>
    </template>

    <div class="grid gap-4">
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="t(errorKey)" />

      <UForm v-if="!sent" :state="state" :validate="validate" novalidate class="liwan-form" @submit="submit">
        <UFormField name="email" :label="t('findWorkspace.email')" required>
          <UInput v-model="state.email" type="email" autocomplete="email" dir="ltr" class="w-full text-start" :disabled="pending" />
        </UFormField>
        <AuthTurnstileWidget
          v-if="humanCheck" ref="widget" :site-key="humanCheck.site_key" :script-url="humanCheck.script_url" :language="widgetLanguage"
          :label="t('findWorkspace.humanCheck')" @verified="humanToken = $event" @cleared="humanToken = undefined" @failed="errorKey = errors.human_check_unavailable"
        />
        <UButton type="submit" size="lg" class="w-full justify-center" :disabled="!hydrated || pending || !checkReady" :loading="pending" :label="t('findWorkspace.submit')" />
      </UForm>

      <template v-else>
        <UAlert role="status" color="success" variant="subtle" icon="i-lucide-mail-check" :description="t('findWorkspace.sent')" />
        <UButton type="button" color="neutral" variant="link" class="w-full justify-center" :label="t('findWorkspace.another')" @click="another" />
      </template>

      <UButton to="/register" color="neutral" variant="link" class="justify-center" :label="t('findWorkspace.noWorkspace')" />
    </div>
  </SharedStandalonePage>
</template>
