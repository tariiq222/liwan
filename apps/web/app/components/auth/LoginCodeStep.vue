<script setup lang="ts">
import type { LoginChannel, LoginChannels, LoginCodeSent } from '@liwan/contracts'
import { isCompleteCode, normalizeCode, offeredChannels, smsUnavailable } from './loginFlow'
import { useResendWait } from './useResendWait'

// The second sign-in step: choose where the code goes, see the server-masked destination, type the six digits and
// finish. `resend_after`, the channel list and the destination all come from the server's own answers; nothing
// here is a hardcoded window or address.
const props = defineProps<{
  channels: LoginChannels
  channel: LoginChannel | null
  sent: LoginCodeSent | null
  /** A fresh `{seconds}` for every accepted or refused send, so an equal wait still restarts the count. */
  wait: { seconds: number } | null
  pending: boolean
  error: string | null
}>()
const emit = defineEmits<{
  select: [channel: LoginChannel]
  send: []
  verify: [payload: { code: string; remember: boolean }]
  another: []
}>()
const { t } = useI18n()
const hydrated = useHydrated()
const offered = computed(() => offeredChannels(props.channels))
const channelItems = computed(() => offered.value.map(option => ({
  value: option,
  label: t(option === 'sms' ? 'auth.channelSmsOption' : 'auth.channelEmailOption'),
  icon: option === 'sms' ? 'i-lucide-message-square' : 'i-lucide-mail',
  testId: `login-channel-${option}`,
})))
const code = ref('')
const remember = ref(false)
const fieldError = ref<string | null>(null)
const { seconds, waiting, start } = useResendWait()

// Each answer restarts the wait the server asked for; the countdown is that deadline, never a local guess.
watch(() => props.wait, next => start(next?.seconds ?? 0), { immediate: true })

function choose(next: string) {
  const option = next as LoginChannel
  if (option === props.channel) return
  fieldError.value = null
  emit('select', option)
}

function submit() {
  const digits = normalizeCode(code.value)
  fieldError.value = digits ? null : t(code.value.trim() ? 'auth.codeFormat' : 'auth.codeRequired')
  if (digits) emit('verify', { code: digits, remember: remember.value })
}
</script>

<template>
  <div class="grid gap-4">
    <UAlert v-if="props.error" role="alert" color="error" variant="subtle" :title="props.error" />

    <div class="grid gap-2">
      <SharedSegmentedControl
        :model-value="props.channel ?? undefined" :items="channelItems" :label="t('auth.channelTitle')"
        :disabled="props.pending" @update:model-value="choose"
      />
      <p v-if="smsUnavailable(props.channels)" class="text-sm text-muted">{{ t('auth.smsUnavailable') }}</p>
    </div>

    <template v-if="props.sent">
      <p class="text-sm text-muted" data-testid="login-destination">
        {{ t(props.sent.channel === 'sms' ? 'auth.codeSentToSms' : 'auth.codeSentToEmail', { destination: props.sent.destination }) }}
      </p>
      <UForm :state="{ code }" class="liwan-form" novalidate @submit="submit">
        <UFormField
          :label="t('auth.codeLabel')" name="code" required :error="fieldError ?? undefined"
          :hint="t('auth.codeHint')"
        >
          <UInput
            id="login-code" v-model="code" inputmode="numeric" autocomplete="one-time-code" dir="ltr"
            class="w-full text-start" data-testid="login-code" :disabled="!hydrated || props.pending"
          />
          <template #error><span v-if="fieldError" role="alert">{{ fieldError }}</span></template>
        </UFormField>
        <div class="grid gap-1">
          <UCheckbox v-model="remember" :label="t('auth.rememberDevice')" :disabled="!hydrated || props.pending" data-testid="login-remember" />
          <p class="text-xs text-muted">{{ t('auth.rememberHint') }}</p>
        </div>
        <p class="text-xs text-muted">{{ t('auth.verifyHint') }}</p>
        <UButton
          type="submit" size="lg" class="w-full justify-center" :label="t('auth.verify')"
          :disabled="!hydrated || props.pending || !isCompleteCode(code)" :loading="props.pending"
        />
      </UForm>
    </template>

    <!-- One polite announcement of the wait: the seconds left, then that a resend is possible. -->
    <p
      v-if="props.sent || waiting" class="text-sm text-muted tabular-nums" role="status" aria-live="polite"
      aria-atomic="true" data-testid="login-resend-wait"
    >
      {{ waiting ? t('auth.resendIn', { seconds }) : t('auth.resendReady') }}
    </p>

    <UButton
      type="button" :color="props.sent ? 'neutral' : 'primary'" :variant="props.sent ? 'outline' : 'solid'"
      :label="props.sent ? t('auth.resendCode') : t('auth.sendCode')"
      :disabled="!hydrated || props.pending || !props.channel || waiting" data-testid="login-send"
      @click="emit('send')"
    />
    <UButton type="button" color="neutral" variant="link" :label="t('auth.useAnotherAccount')" :disabled="!hydrated || props.pending" data-testid="login-another" @click="emit('another')" />
  </div>
</template>
