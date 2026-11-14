<script setup lang="ts">
import { useInboxProviderError } from '@/composables/inbox/inboxProviderError'
import { InboxChannelPatchSchema } from '@liwan/contracts'
import { statusTag } from '@liwan/ui/app/utils/pageHeaderTag'
import InboxChannelFailedDeliveries from '@/components/inbox/InboxChannelFailedDeliveries.vue'
import InboxChannelTabs from '@/components/inbox/InboxChannelTabs.vue'
import { useInboxCatalogEnabled } from '@/composables/inbox/useInboxCatalog'
import { useInboxFlowsEnabled, useInboxTemplatesEnabled } from '@/composables/inbox/inboxFeatures'
import { channelKindLabelKey } from '@/composables/inbox/inboxChannelKind'
import { CHANNEL_STATE_TONE } from '@/composables/inbox/inboxPresentation'
import { connectionOptionLabel, connectionPagePath } from '@/composables/inbox/inboxChannelConnection'
import { inboxTikTokErrorKey } from '@/composables/inbox/inboxTikTok'
import { SHORTCUT_AUDIT_TONE } from '@/composables/inbox/inboxTikTokShortcuts'
import {
  useDeleteInboxChannel, useInboxChannel, useInboxDepartments, usePatchInboxChannel, useSyncInboxTemplates, useTestInboxChannel,
} from '@/composables/inbox/useInboxSettings'

// One channel, by kind. It runs on an account connected at /settings/integrations, so this page holds no credential,
// webhook or reconnect: a channel whose account needs attention links to that account. A WhatsApp number: its status and
// tests, the editable name and department, and the inline-confirmed delete. A TikTok account: the trust of its welcome
// message; it has no business profile and no templates. Both keep their page tabs.
const route = useRoute()
const { t, locale } = useI18n()
const { providerText } = useInboxProviderError()
const hydrated = useHydrated()
const toast = useToast()
const { can } = useAccess()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const backTo = '/settings/apps/inbox#channels'
const query = useInboxChannel(id)
const channel = query.data
const departments = useInboxDepartments()
const { mutate: patch, isPending: patching } = usePatchInboxChannel(() => id.value ?? 0)
const { mutate: test, isPending: testing } = useTestInboxChannel(() => id.value ?? 0)
const { mutate: sync, isPending: syncing } = useSyncInboxTemplates(() => id.value ?? 0)
const { mutate: remove, isPending: removing } = useDeleteInboxChannel()
const manage = computed(() => can('inbox.channels.manage'))
const catalogOn = useInboxCatalogEnabled()
const templatesOn = useInboxTemplatesEnabled()
const flowsOn = useInboxFlowsEnabled()
const manageTemplates = computed(() => can('inbox.templates.manage'))
const isTikTok = computed(() => channel.value?.kind === 'tiktok')
const canOpenConnection = computed(() => can('integrations.read'))
const busy = computed(() => !hydrated.value || patching.value || testing.value || syncing.value || removing.value)

const NONE = 'none'
const name = ref('')
const department = ref(NONE)
const confirmingDelete = ref(false)
watch(channel, (value) => {
  if (!value) return
  name.value = value.name
  department.value = value.department ? String(value.department.id) : NONE
}, { immediate: true })
const departmentItems = computed(() => [
  { value: NONE, label: t('inbox.settings.channels.noDepartment') },
  ...(departments.data.value?.items ?? []).map(item => ({ value: String(item.id), label: item.name })),
])
const detailsDirty = computed(() => !!channel.value && (name.value.trim() !== channel.value.name || department.value !== (channel.value.department ? String(channel.value.department.id) : NONE)))
const detailsValid = computed(() => InboxChannelPatchSchema.safeParse({ name: name.value.trim() }).success)
const tags = computed(() => channel.value ? [statusTag({ tone: CHANNEL_STATE_TONE[channel.value.state], label: t(`inbox.channelStates.${channel.value.state}`) })] : [])
const lastEvent = computed(() => channel.value?.last_event_at ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(channel.value.last_event_at)) : t('inbox.settings.channels.noEvents'))
const welcomeAudit = computed(() => channel.value?.tiktok_welcome_audit ?? null)
// A connection in `error`, or a TikTok grant the provider no longer accepts, is fixed on the account's own page.
const connectionNeedsAttention = computed(() => !!channel.value && (channel.value.connection.state === 'error' || channel.value.needs_reconnect))
const connectionLabel = computed(() => (channel.value ? connectionOptionLabel(channel.value.connection) : ''))
const connectionPath = computed(() => (channel.value ? connectionPagePath(channel.value.connection.id) : ''))
// The channel's last failure is Meta's English for a WhatsApp number: it is translated when known and tagged otherwise.
const channelError = computed(() => (channel.value?.last_error ? (isTikTok.value ? channel.value.last_error : providerText(channel.value.last_error)) : ''))

function fail(e: unknown) {
  const key = inboxTikTokErrorKey(e)
  toast.add({ title: key ? t(key) : e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
}
function saveDetails() {
  if (busy.value || !detailsDirty.value || !detailsValid.value) return
  patch({ name: name.value.trim(), department_id: department.value === NONE ? null : Number(department.value) }, {
    onSuccess: () => toast.add({ title: t('inbox.settings.saved'), color: 'success' }),
    onError: fail,
  })
}
function toggleEnabled() {
  if (busy.value || !channel.value) return
  if (channel.value.state === 'disabled') runTest()
  else patch({ state: 'disabled' }, { onError: fail })
}
// A passing test connects the channel (this is also how a disabled one is enabled); a failing one says so.
function runTest() {
  test(undefined, {
    onSuccess: result => result.state === 'connected'
      ? toast.add({ title: t('inbox.settings.channels.tested'), color: 'success' })
      : toast.add({ title: t('inbox.settings.channels.testFailed'), description: result.last_error ?? undefined, color: 'error' }),
    onError: fail,
  })
}
function runSync() {
  sync(undefined, { onSuccess: () => toast.add({ title: t('inbox.settings.channels.synced'), color: 'success' }), onError: fail })
}
function confirmDelete() {
  if (!channel.value) return
  remove(channel.value.id, { onSuccess: () => navigateTo(backTo, { replace: true }), onError: fail })
}
</script>

<template>
  <SharedRecordPage
    :title="channel?.name ?? t('inbox.settings.channels.title')"
    :tags="tags"
    :back-to="backTo"
    :back-label="t('inbox.settings.channels.title')"
    :loading="id !== null && query.isPending.value"
    :error="id === null ? { status: 404 } : query.error.value"
    @retry="hydrated && query.refetch()"
  >
    <template v-if="channel && manage && !isTikTok" #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-plug-zap" :loading="testing" :disabled="busy" :label="t('inbox.settings.channels.test')" data-testid="inbox-channel-test" @click="runTest" />
      <UButton v-if="templatesOn" color="neutral" variant="outline" icon="i-lucide-file-text" :to="`/settings/apps/inbox/channels/${channel?.id}/templates`" :disabled="busy" :label="t('inbox.templates.title')" data-testid="inbox-channel-templates" />
      <UButton v-if="flowsOn" color="neutral" variant="outline" icon="i-lucide-clipboard-list" :to="`/settings/apps/inbox/channels/${channel?.id}/flows`" :disabled="busy" :label="t('inbox.flows.title')" data-testid="inbox-channel-flows" />
      <UButton v-if="can('inbox.automation.manage')" color="neutral" variant="outline" icon="i-lucide-bot-message-square" :to="`/settings/apps/inbox/auto-messages/${channel?.id}`" :disabled="busy" :label="t('inbox.automation.messages.title')" data-testid="inbox-channel-automation" />
      <UButton v-if="manageTemplates" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="syncing" :disabled="busy" :label="t('inbox.settings.channels.syncTemplates')" data-testid="inbox-channel-sync" @click="runSync" />
    </template>

    <template v-if="channel">
      <InboxChannelTabs v-if="manage" :channel-id="channel.id" :kind="channel.kind" />
      <InboxChannelFailedDeliveries v-if="manage && isTikTok" :channel-id="channel.id" />
      <UAlert v-if="channel.last_error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.settings.channels.lastError')" :description="channelError" data-testid="inbox-channel-error" />

      <UAlert
        v-if="connectionNeedsAttention"
        role="alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-plug-zap"
        :title="t('inbox.settings.channels.connectionAttention')"
        :description="channel.connection.status_message || t('inbox.settings.channels.connectionAttentionHint')"
        :actions="canOpenConnection ? [{ label: t('inbox.settings.channels.connectionOpen'), to: connectionPath, color: 'neutral', variant: 'outline' }] : undefined"
        data-testid="inbox-channel-connection-alert"
      />

      <SharedRecordSection v-if="isTikTok" variant="panel" :title="t('inbox.tiktok.details')">
        <dl class="liwan-auto-grid">
          <div>
            <dt class="text-xs text-muted">{{ t('inbox.tiktok.welcomeAudit') }}</dt>
            <dd>
              <SharedStatusBadge v-if="welcomeAudit" :tone="SHORTCUT_AUDIT_TONE[welcomeAudit]" :label="t(`inbox.tiktok.audit.${welcomeAudit}`)" data-testid="inbox-tiktok-welcome-audit" />
              <span v-else class="text-sm text-muted">{{ t('inbox.tiktok.noWelcomeAudit') }}</span>
            </dd>
          </div>
        </dl>
      </SharedRecordSection>

      <form v-if="manage" @submit.prevent="saveDetails">
        <SharedRecordSection variant="panel" :title="t('inbox.settings.channels.details')">
          <div class="flex flex-col gap-4">
            <UFormField :label="t('inbox.settings.name')" required>
              <UInput v-model="name" class="w-full" maxlength="128" :disabled="busy" data-testid="inbox-channel-edit-name" />
            </UFormField>
            <UFormField :label="t('inbox.settings.channels.department')" :description="t('inbox.settings.channels.departmentHint')">
              <USelect v-model="department" :items="departmentItems" class="w-full" :disabled="busy" />
            </UFormField>
            <div class="flex justify-end">
              <UButton type="submit" :disabled="busy || !detailsDirty || !detailsValid" :loading="patching" :label="t('app.save')" />
            </div>
          </div>
        </SharedRecordSection>
      </form>

      <InboxChannelCommerceSection v-if="!isTikTok && catalogOn && manage" :channel-id="channel.id" :manage="can('inbox.catalog.manage')" />

      <SharedRecordSection v-if="manage" variant="panel" :title="t('inbox.settings.channels.dangerTitle')">
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="min-w-0 flex-1 text-sm text-muted">{{ channel.state === 'disabled' ? t('inbox.settings.channels.enableHint') : t('inbox.settings.channels.disableHint') }}</p>
            <UButton type="button" color="neutral" variant="outline" :disabled="busy" :label="channel.state === 'disabled' ? t('inbox.settings.channels.enable') : t('inbox.settings.channels.disable')" data-testid="inbox-channel-toggle" @click="toggleEnabled" />
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="min-w-0 flex-1 text-sm text-muted">{{ t('inbox.settings.channels.deleteHint') }}</p>
            <UButton type="button" color="error" variant="outline" :disabled="busy || confirmingDelete" :label="t('inbox.settings.channels.delete')" data-testid="inbox-channel-delete" @click="confirmingDelete = true" />
          </div>
          <SharedInlineConfirm
            v-if="confirmingDelete"
            :title="t('inbox.settings.channels.deleteTitle', { name: channel.name })"
            :description="t('inbox.settings.channels.deleteDescription')"
            :confirm-label="t('inbox.settings.channels.delete')"
            :pending="removing"
            @confirm="confirmDelete"
            @cancel="confirmingDelete = false"
          />
        </div>
      </SharedRecordSection>
    </template>

    <template v-if="channel" #aside>
      <SharedPropertiesPanel :title="t('inbox.settings.channels.status')">
        <SharedPropertyRow :label="t('inbox.settings.channels.kind')" :value="t(channelKindLabelKey(channel.kind))" />
        <SharedPropertyRow v-if="!isTikTok" :label="t('inbox.settings.channels.phoneNumberId')"><bdi dir="ltr">{{ channel.phone_number_id }}</bdi></SharedPropertyRow>
        <SharedPropertyRow :label="t('inbox.settings.channels.connection')">
          <NuxtLink v-if="canOpenConnection" :to="connectionPath" class="text-primary hover:underline" data-testid="inbox-channel-connection-link"><bdi dir="auto">{{ connectionLabel }}</bdi></NuxtLink>
          <bdi v-else dir="auto">{{ connectionLabel }}</bdi>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('inbox.settings.channels.department')" :value="channel.department?.name ?? t('inbox.settings.channels.noDepartment')" />
        <SharedPropertyRow :label="t('inbox.settings.channels.lastEvent')" :value="lastEvent" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
