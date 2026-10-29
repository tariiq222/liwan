<script setup lang="ts">
import { InboxDisplayNameRequestSchema, InboxPinSchema, type InboxChannel } from '@webvue/contracts'
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import {
  useEnableInboxTemplateInsights, useRegisterInboxNumber, useRequestInboxDisplayName, useSetInboxTwoStepPin, useSyncInboxAnalytics,
} from '@/composables/inbox/useInboxChannelHealth'

// The number administration actions of the health page, each sent straight to Meta: request a display name, set the
// two-step PIN, register the number, enable template analytics (irreversible) and sync the analytics now. The PIN is
// typed, sent once and cleared: it is never prefilled, stored or shown again.
const props = defineProps<{ channel: InboxChannel }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()

const channelId = computed(() => props.channel.id)
const displayName = useRequestInboxDisplayName(channelId)
const setPin = useSetInboxTwoStepPin(channelId)
const register = useRegisterInboxNumber(channelId)
const insights = useEnableInboxTemplateInsights(channelId)
const sync = useSyncInboxAnalytics(channelId)
const busy = computed(() => !hydrated.value || [displayName, setPin, register, insights, sync].some(action => action.isPending.value))

const name = ref('')
const pin = ref('')
const registerPin = ref('')
const confirmingRegister = ref(false)
const confirmingInsights = ref(false)

const nameValid = computed(() => InboxDisplayNameRequestSchema.safeParse({ name: name.value }).success)
const pinValid = computed(() => InboxPinSchema.safeParse({ pin: pin.value }).success)
const registerPinValid = computed(() => InboxPinSchema.safeParse({ pin: registerPin.value }).success)
const digits = (value: string) => value.replace(/\D/g, '').slice(0, 6)

const fail = (e: unknown) => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
const done = (key: string) => toast.add({ title: t(key), color: 'success' })

function submitName() {
  if (busy.value || !nameValid.value) return
  displayName.mutate({ name: name.value.trim() }, { onSuccess: () => { name.value = ''; done('inbox.health.actions.displayName.done') }, onError: fail })
}
function submitPin() {
  if (busy.value || !pinValid.value) return
  setPin.mutate({ pin: pin.value }, { onSuccess: () => done('inbox.health.actions.pin.done'), onError: fail, onSettled: () => { pin.value = '' } })
}
function confirmRegister() {
  if (busy.value || !registerPinValid.value) return
  register.mutate({ pin: registerPin.value }, {
    onSuccess: () => { confirmingRegister.value = false; done('inbox.health.actions.register.done') },
    onError: fail,
    onSettled: () => { registerPin.value = '' },
  })
}
function confirmInsights() {
  insights.mutate({}, { onSuccess: () => { confirmingInsights.value = false; done('inbox.health.actions.insights.done') }, onError: fail })
}
function syncNow() {
  sync.mutate({}, {
    // Meta's refusal (an EU account, an expired token) comes back as a 200 with the error stored on the channel.
    onSuccess: result => result.health.analytics_error
      ? toast.add({ title: result.health.analytics_error, color: 'error' })
      : done('inbox.health.actions.sync.done'),
    onError: fail,
  })
}
const syncedAt = computed(() => props.channel.health.analytics_synced_at ? formatDateTime(props.channel.health.analytics_synced_at) : null)
</script>

<template>
  <div class="flex min-w-0 flex-col gap-(--webvue-gap-card)" data-testid="inbox-health-actions">
    <form @submit.prevent="submitName">
      <SharedRecordSection variant="panel" :title="t('inbox.health.actions.displayName.title')" :description="t('inbox.health.actions.displayName.hint')">
        <div class="flex flex-wrap items-end gap-3">
          <UFormField :label="t('inbox.health.actions.displayName.label')" :error="name && !nameValid ? t('inbox.health.actions.displayName.invalid') : undefined" class="min-w-56 flex-1">
            <UInput v-model="name" class="w-full" maxlength="128" autocomplete="off" :disabled="busy" data-testid="inbox-health-name-input" />
          </UFormField>
          <UButton type="submit" :loading="displayName.isPending.value" :disabled="busy || !nameValid" :label="t('inbox.health.actions.displayName.submit')" data-testid="inbox-health-name-submit" />
        </div>
      </SharedRecordSection>
    </form>

    <form @submit.prevent="submitPin">
      <SharedRecordSection variant="panel" :title="t('inbox.health.actions.pin.title')" :description="t('inbox.health.actions.pin.hint')">
        <div class="flex flex-wrap items-end gap-3">
          <UFormField :label="t('inbox.health.actions.pin.label')" :error="pin && !pinValid ? t('inbox.health.actions.pin.invalid') : undefined" class="min-w-56 flex-1">
            <UInput :model-value="pin" type="password" class="w-full" dir="ltr" inputmode="numeric" maxlength="6" autocomplete="off" :disabled="busy" data-testid="inbox-health-pin-input" @update:model-value="pin = digits(String($event))" />
          </UFormField>
          <UButton type="submit" :loading="setPin.isPending.value" :disabled="busy || !pinValid" :label="t('inbox.health.actions.pin.submit')" data-testid="inbox-health-pin-submit" />
        </div>
      </SharedRecordSection>
    </form>

    <SharedRecordSection variant="panel" :title="t('inbox.health.actions.register.title')" :description="t('inbox.health.actions.register.hint')">
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-end gap-3">
          <UFormField :label="t('inbox.health.actions.register.pinLabel')" class="min-w-56 flex-1">
            <UInput :model-value="registerPin" type="password" class="w-full" dir="ltr" inputmode="numeric" maxlength="6" autocomplete="off" :disabled="busy || confirmingRegister" data-testid="inbox-health-register-pin" @update:model-value="registerPin = digits(String($event))" />
          </UFormField>
          <UButton type="button" color="neutral" variant="outline" :disabled="busy || confirmingRegister || !registerPinValid" :label="t('inbox.health.actions.register.button')" data-testid="inbox-health-register" @click="confirmingRegister = true" />
        </div>
        <SharedInlineConfirm
          v-if="confirmingRegister" color="warning" :title="t('inbox.health.actions.register.confirmTitle')" :description="t('inbox.health.actions.register.confirmDescription')"
          :confirm-label="t('inbox.health.actions.register.confirm')" :pending="register.isPending.value" @confirm="confirmRegister" @cancel="confirmingRegister = false"
        />
      </div>
    </SharedRecordSection>

    <SharedRecordSection variant="panel" :title="t('inbox.health.actions.insights.title')" :description="t('inbox.health.actions.insights.hint')">
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <SharedStatusBadge v-if="channel.health.template_insights_enabled" tone="success" :label="t('inbox.health.actions.insights.enabled')" data-testid="inbox-health-insights-on" />
          <UButton v-else type="button" color="neutral" variant="outline" :disabled="busy || confirmingInsights" :label="t('inbox.health.actions.insights.enable')" data-testid="inbox-health-insights" @click="confirmingInsights = true" />
        </div>
        <SharedInlineConfirm
          v-if="confirmingInsights && !channel.health.template_insights_enabled" color="warning" :title="t('inbox.health.actions.insights.confirmTitle')" :description="t('inbox.health.actions.insights.confirmDescription')"
          :confirm-label="t('inbox.health.actions.insights.confirm')" :pending="insights.isPending.value" @confirm="confirmInsights" @cancel="confirmingInsights = false"
        />
      </div>
    </SharedRecordSection>

    <SharedRecordSection variant="panel" :title="t('inbox.health.actions.sync.title')" :description="t('inbox.health.actions.sync.hint')">
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1 text-sm text-muted">
            <span data-testid="inbox-health-synced">{{ syncedAt ? t('inbox.health.actions.sync.last', { time: syncedAt }) : t('inbox.health.actions.sync.never') }}</span>
            <span v-if="channel.health.currency" dir="auto">{{ t('inbox.health.actions.currency', { currency: channel.health.currency }) }}</span>
          </div>
          <UButton type="button" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="sync.isPending.value" :disabled="busy" :label="t('inbox.health.actions.sync.button')" data-testid="inbox-health-sync" @click="syncNow" />
        </div>
        <UAlert v-if="channel.health.analytics_error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.health.actions.sync.error')" :description="channel.health.analytics_error" data-testid="inbox-health-sync-error" />
      </div>
    </SharedRecordSection>
  </div>
</template>
