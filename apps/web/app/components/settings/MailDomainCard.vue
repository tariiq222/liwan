<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import type { MailDomainState } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'
import {
  mailDomainErrorKey,
  mailDomainShown,
  returnPathHoursLeft,
  useMailDomain,
  useMailUsage,
  useRemoveMailDomain,
  useStartMailDomain,
  useTestSendMail,
  useVerifyMailDomain,
} from '@/composables/settings/useMailDomain'

// The tenant's own sending domain, in four states: not started (domain and sender name), waiting for the DNS records
// (copy each, verify), verified (sender, test send, remove; today's usage only near the daily ceiling) and failed
// (reason, check again or remove). The page mounts the card only for a holder of `mail.domain.manage` in a SaaS build;
// the card also stays absent while the server has no mail provider configured.
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const clipboard = useClipboard({ copiedDuring: 2000 })
const { data: domain, isLoading, error, refetch } = useMailDomain()
const start = useStartMailDomain()
const verify = useVerifyMailDomain()
const remove = useRemoveMailDomain()
const testSend = useTestSendMail()
const { data: usage } = useMailUsage(() => domain.value?.state === 'verified')

const form = reactive({ domain: '', from_local_part: '' })
const failure = ref('')
const confirmingRemove = ref(false)
const copiedName = ref('')

// An unverified domain that expired comes back as not started with its old values: they prefill the form.
watch(domain, (current) => {
  if (current?.state !== 'not_started') return
  if (!form.domain && current.domain) form.domain = current.domain
  if (!form.from_local_part && current.from_local_part) form.from_local_part = current.from_local_part
}, { immediate: true })

const shown = computed(() => mailDomainShown(domain.value))
const working = computed(() => start.isPending.value || verify.isPending.value || remove.isPending.value || testSend.isPending.value)
const locked = computed(() => !hydrated.value || working.value)
const startReady = computed(() => form.domain.trim() !== '' && form.from_local_part.trim() !== '')
const hoursLeft = computed(() => (domain.value ? returnPathHoursLeft(domain.value) : null))
const stateTone: Record<MailDomainState, StatusTone> = { not_started: 'neutral', pending_dns: 'warning', verified: 'success', failed: 'destructive' }
const nearCeiling = computed(() => usage.value?.near_ceiling === true)

async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
  failure.value = ''
  try {
    return await action()
  } catch (caught) {
    failure.value = t(mailDomainErrorKey(caught))
    return undefined
  }
}

async function submitStart() {
  if (!startReady.value) return
  await run(() => start.mutateAsync({ domain: form.domain, from_local_part: form.from_local_part }))
}

async function checkNow() {
  const result = await run(() => verify.mutateAsync())
  if (!result) return
  if (result.state === 'verified') toast.add({ title: t('settings.mail.verifiedToast'), color: 'success' })
  else if (result.state === 'pending_dns') toast.add({ title: t('settings.mail.verifyStillPending'), color: 'neutral' })
}

async function sendTest() {
  if (await run(() => testSend.mutateAsync())) toast.add({ title: t('settings.mail.testSent'), color: 'success' })
}

async function removeDomain() {
  const result = await run(() => remove.mutateAsync())
  confirmingRemove.value = false
  if (result) {
    form.domain = ''
    form.from_local_part = ''
    toast.add({ title: t('settings.mail.removed'), color: 'success' })
  }
}

async function copy(name: string, value: string) {
  await clipboard.copy(value)
  copiedName.value = name
}
</script>

<template>
  <SharedRecordSection v-if="shown && domain" id="mail" variant="panel" class="liwan-settings-anchor" :title="t('settings.mail.title')" :description="t('settings.mail.hint')">
    <div class="grid gap-4 text-start" data-testid="mail-domain">
      <SharedStatusBadge :tone="stateTone[domain.state]" :label="t(`settings.mail.state.${domain.state}`)" data-testid="mail-state" />

      <form v-if="domain.state === 'not_started'" class="grid gap-4" data-testid="mail-start" @submit.prevent="submitStart">
        <UAlert v-if="domain.last_error" color="warning" variant="subtle" :description="domain.last_error" data-testid="mail-expired" />
        <p class="text-sm text-muted">{{ t('settings.mail.intro') }}</p>
        <UFormField name="mail-domain" :label="t('settings.mail.domain')">
          <UInput v-model="form.domain" dir="ltr" autocomplete="off" :placeholder="t('settings.mail.domainPlaceholder')" :disabled="locked" data-testid="mail-domain-input" />
        </UFormField>
        <UFormField name="mail-local-part" :label="t('settings.mail.localPart')" :hint="t('settings.mail.localPartHint')">
          <UInput v-model="form.from_local_part" dir="ltr" autocomplete="off" placeholder="info" :disabled="locked" data-testid="mail-local-part-input" />
        </UFormField>
        <div><UButton type="submit" color="primary" :loading="start.isPending.value" :disabled="locked || !startReady" :label="t('settings.mail.start')" data-testid="mail-start-button" /></div>
      </form>

      <template v-else-if="domain.state === 'pending_dns'">
        <p class="text-sm text-muted">{{ t('settings.mail.records.hint') }}</p>
        <p v-if="domain.records.length < 3" class="text-sm text-muted" data-testid="mail-records-preparing">{{ t('settings.mail.records.preparing') }}</p>
        <ul class="divide-y divide-default rounded-md border border-default" data-testid="mail-records">
          <li v-for="record in domain.records" :key="record.kind" class="grid min-w-0 gap-2 p-3" :data-testid="`mail-record-${record.kind}`">
            <div class="flex items-center justify-between gap-2">
              <p class="font-medium text-highlighted">{{ t(`settings.mail.records.kind.${record.kind}`) }} <span class="text-sm text-muted"><bdi>{{ record.type }}</bdi></span></p>
              <UButton color="neutral" variant="outline" size="sm" :icon="copiedName === record.kind && clipboard.copied.value ? 'i-lucide-check' : 'i-lucide-copy'" :label="copiedName === record.kind && clipboard.copied.value ? t('settings.mail.records.copied') : t('settings.mail.records.copy')" :disabled="!hydrated" :data-testid="`mail-copy-${record.kind}`" @click="copy(record.kind, record.value)" />
            </div>
            <p class="text-sm text-muted">{{ t('settings.mail.records.name') }}</p>
            <p class="break-all font-mono text-sm" dir="ltr">{{ record.name }}</p>
            <p class="text-sm text-muted">{{ t('settings.mail.records.value') }}</p>
            <p class="break-all font-mono text-sm" dir="ltr">{{ record.value }}</p>
          </li>
        </ul>
        <p v-if="hoursLeft !== null" class="text-sm text-muted" data-testid="mail-return-path-left">{{ hoursLeft > 0 ? t('settings.mail.returnPathLeft', { hours: hoursLeft }) : t('settings.mail.returnPathExpired') }}</p>
        <UAlert v-if="domain.return_path_recreated_at" color="warning" variant="subtle" :description="t('settings.mail.returnPathRecreated', { at: formatDateTime(domain.return_path_recreated_at) })" data-testid="mail-recreated" />
        <div class="flex flex-wrap gap-2">
          <UButton color="primary" icon="i-lucide-refresh-cw" :loading="verify.isPending.value" :disabled="locked" :label="t('settings.mail.verify')" data-testid="mail-verify" @click="checkNow" />
          <UButton color="error" variant="outline" icon="i-lucide-trash-2" :disabled="locked || confirmingRemove" :label="t('settings.mail.remove')" data-testid="mail-remove" @click="confirmingRemove = true" />
        </div>
      </template>

      <template v-else-if="domain.state === 'verified'">
        <div>
          <p class="text-sm text-muted">{{ t('settings.mail.sender') }}</p>
          <p class="font-medium text-highlighted" dir="ltr" data-testid="mail-sender">{{ domain.sender_address }}</p>
          <p v-if="domain.verified_at" class="text-sm text-muted">{{ t('settings.mail.verifiedAt', { at: formatDateTime(domain.verified_at) }) }}</p>
        </div>
        <UAlert v-if="domain.paused" color="warning" variant="subtle" icon="i-lucide-circle-pause" :title="t('settings.mail.paused')" :description="domain.pause_reason ? t('settings.mail.pausedReason', { reason: domain.pause_reason }) : undefined" data-testid="mail-paused" />
        <UAlert v-if="usage && nearCeiling" color="warning" variant="subtle" :title="t('settings.mail.usage.title')" :description="`${t('settings.mail.usage.text', { today: usage.today, ceiling: usage.ceiling })} ${t('settings.mail.usage.deferred', { deferred: usage.deferred })}`" data-testid="mail-usage" />
        <div class="flex flex-wrap gap-2">
          <UButton color="neutral" variant="outline" icon="i-lucide-send" :loading="testSend.isPending.value" :disabled="locked || domain.paused" :label="t('settings.mail.testSend')" data-testid="mail-test-send" @click="sendTest" />
          <UButton color="error" variant="outline" icon="i-lucide-trash-2" :disabled="locked || confirmingRemove" :label="t('settings.mail.remove')" data-testid="mail-remove" @click="confirmingRemove = true" />
        </div>
      </template>

      <template v-else>
        <UAlert color="error" variant="subtle" :title="t('settings.mail.failedTitle')" :description="domain.last_error ?? undefined" data-testid="mail-failed" />
        <div class="flex flex-wrap gap-2">
          <UButton color="primary" icon="i-lucide-refresh-cw" :loading="verify.isPending.value" :disabled="locked" :label="t('settings.mail.retry')" data-testid="mail-retry" @click="checkNow" />
          <UButton color="error" variant="outline" icon="i-lucide-trash-2" :disabled="locked || confirmingRemove" :label="t('settings.mail.remove')" data-testid="mail-remove" @click="confirmingRemove = true" />
        </div>
      </template>

      <SharedInlineConfirm
        v-if="confirmingRemove"
        :title="t('settings.mail.confirmRemoveTitle')"
        :description="t('settings.mail.confirmRemoveDescription')"
        :confirm-label="t('settings.mail.confirmRemove')"
        :pending="remove.isPending.value"
        @confirm="removeDomain"
        @cancel="confirmingRemove = false"
      />
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="mail-error" />
    </div>
  </SharedRecordSection>
  <!-- Until the answer arrives (or fails) an anchor target keeps a direct link to #mail working; a server without the provider shows nothing. -->
  <div v-else-if="isLoading || error" id="mail" class="liwan-settings-anchor">
    <SharedPageState :loading="isLoading" :error="error" :empty="false" @retry="refetch()" />
  </div>
</template>
