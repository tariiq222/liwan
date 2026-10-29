<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { InboxChannelPatchSchema } from '@webvue/contracts'
import { statusTag } from '@webvue/ui/app/utils/pageHeaderTag'
import InboxChannelTabs from '@/components/inbox/InboxChannelTabs.vue'
import { useInboxCatalogEnabled } from '@/composables/inbox/useInboxCatalog'
import { CHANNEL_STATE_TONE } from '@/composables/inbox/inboxPresentation'
import {
  useDeleteInboxChannel, useInboxChannel, useInboxDepartments, usePatchInboxChannel, useSyncInboxTemplates, useTestInboxChannel,
} from '@/composables/inbox/useInboxSettings'

// One channel: its status and tests, the webhook details to paste into the Meta app, the editable name and department,
// replaceable secrets (write-only) and the inline-confirmed delete.
const route = useRoute()
const { t, locale } = useI18n()
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
const manageTemplates = computed(() => can('inbox.templates.manage'))
const busy = computed(() => !hydrated.value || patching.value || testing.value || syncing.value || removing.value)

const NONE = 'none'
const name = ref('')
const department = ref(NONE)
const appId = ref('')
const accessToken = ref('')
const appSecret = ref('')
const confirmingDelete = ref(false)
watch(channel, (value) => {
  if (!value) return
  name.value = value.name
  department.value = value.department ? String(value.department.id) : NONE
  appId.value = value.app_id ?? ''
}, { immediate: true })
const departmentItems = computed(() => [
  { value: NONE, label: t('inbox.settings.channels.noDepartment') },
  ...(departments.data.value?.items ?? []).map(item => ({ value: String(item.id), label: item.name })),
])
const appIdValue = computed(() => appId.value.trim() || null)
const detailsDirty = computed(() => !!channel.value && (name.value.trim() !== channel.value.name || department.value !== (channel.value.department ? String(channel.value.department.id) : NONE) || appIdValue.value !== channel.value.app_id))
const detailsValid = computed(() => InboxChannelPatchSchema.safeParse({ name: name.value.trim(), app_id: appIdValue.value }).success)
const tags = computed(() => channel.value ? [statusTag({ tone: CHANNEL_STATE_TONE[channel.value.state], label: t(`inbox.channelStates.${channel.value.state}`) })] : [])
const lastEvent = computed(() => channel.value?.last_event_at ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(channel.value.last_event_at)) : t('inbox.settings.channels.noEvents'))

function fail(e: unknown) {
  toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
}
function saveDetails() {
  if (busy.value || !detailsDirty.value || !detailsValid.value) return
  patch({ name: name.value.trim(), department_id: department.value === NONE ? null : Number(department.value), app_id: appIdValue.value }, {
    onSuccess: () => toast.add({ title: t('inbox.settings.saved'), color: 'success' }),
    onError: fail,
  })
}
const secretsDirty = computed(() => !!accessToken.value.trim() || !!appSecret.value.trim())
const secretsValid = computed(() => InboxChannelPatchSchema.safeParse({
  ...(accessToken.value.trim() ? { access_token: accessToken.value.trim() } : {}),
  ...(appSecret.value.trim() ? { app_secret: appSecret.value.trim() } : {}),
}).success)
function saveSecrets() {
  if (busy.value || !secretsDirty.value || !secretsValid.value) return
  patch({
    ...(accessToken.value.trim() ? { access_token: accessToken.value.trim() } : {}),
    ...(appSecret.value.trim() ? { app_secret: appSecret.value.trim() } : {}),
  }, {
    onSuccess: () => {
      accessToken.value = ''
      appSecret.value = ''
      toast.add({ title: t('inbox.settings.channels.secretsReplaced'), color: 'success' })
    },
    onError: fail,
  })
}
function toggleEnabled() {
  if (busy.value || !channel.value) return
  patch({ state: channel.value.state === 'disabled' ? 'connected' : 'disabled' }, { onError: fail })
}
function runTest() {
  test(undefined, { onSuccess: () => toast.add({ title: t('inbox.settings.channels.tested'), color: 'success' }), onError: fail })
}
function runSync() {
  sync(undefined, { onSuccess: () => toast.add({ title: t('inbox.settings.channels.synced'), color: 'success' }), onError: fail })
}
function confirmDelete() {
  if (!channel.value) return
  remove(channel.value.id, { onSuccess: () => navigateTo(backTo, { replace: true }), onError: fail })
}

const clipboard = useClipboard({ copiedDuring: 2000 })
const copied = ref<'callback' | 'token' | null>(null)
async function copy(kind: 'callback' | 'token', value: string) {
  await clipboard.copy(value)
  copied.value = kind
  setTimeout(() => { if (copied.value === kind) copied.value = null }, 2000)
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
    <template v-if="channel && manage" #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-plug-zap" :loading="testing" :disabled="busy" :label="t('inbox.settings.channels.test')" data-testid="inbox-channel-test" @click="runTest" />
      <UButton color="neutral" variant="outline" icon="i-lucide-file-text" :to="`/settings/apps/inbox/channels/${channel?.id}/templates`" :disabled="busy" :label="t('inbox.templates.title')" data-testid="inbox-channel-templates" />
      <UButton color="neutral" variant="outline" icon="i-lucide-clipboard-list" :to="`/settings/apps/inbox/channels/${channel?.id}/flows`" :disabled="busy" :label="t('inbox.flows.title')" data-testid="inbox-channel-flows" />
      <UButton v-if="can('inbox.automation.manage')" color="neutral" variant="outline" icon="i-lucide-bot-message-square" :to="`/settings/apps/inbox/auto-messages/${channel?.id}`" :disabled="busy" :label="t('inbox.automation.messages.title')" data-testid="inbox-channel-automation" />
      <UButton v-if="manageTemplates" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="syncing" :disabled="busy" :label="t('inbox.settings.channels.syncTemplates')" data-testid="inbox-channel-sync" @click="runSync" />
    </template>

    <template v-if="channel">
      <InboxChannelTabs v-if="manage" :channel-id="channel.id" />
      <UAlert v-if="channel.last_error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.settings.channels.lastError')" :description="channel.last_error" data-testid="inbox-channel-error" />

      <SharedRecordSection id="webhook" variant="panel" :title="t('inbox.settings.channels.webhook.title')" :description="t('inbox.settings.channels.webhook.hint')">
        <div class="flex flex-col gap-4">
          <UFormField :label="t('inbox.settings.channels.webhook.callbackUrl')">
            <div class="flex gap-2">
              <UInput :model-value="channel.callback_url" readonly class="min-w-0 flex-1" dir="ltr" data-testid="inbox-channel-callback" />
              <UButton type="button" color="neutral" variant="outline" :icon="copied === 'callback' ? 'i-lucide-check' : 'i-lucide-copy'" :label="copied === 'callback' ? t('inbox.settings.channels.webhook.copied') : t('inbox.settings.channels.webhook.copy')" @click="copy('callback', channel.callback_url)" />
            </div>
          </UFormField>
          <UFormField :label="t('inbox.settings.channels.webhook.verifyToken')">
            <div class="flex gap-2">
              <UInput :model-value="channel.verify_token" readonly class="min-w-0 flex-1" dir="ltr" data-testid="inbox-channel-verify-token" />
              <UButton type="button" color="neutral" variant="outline" :icon="copied === 'token' ? 'i-lucide-check' : 'i-lucide-copy'" :label="copied === 'token' ? t('inbox.settings.channels.webhook.copied') : t('inbox.settings.channels.webhook.copy')" @click="copy('token', channel.verify_token)" />
            </div>
          </UFormField>
        </div>
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
            <UFormField :label="t('inbox.settings.channels.appId')" :description="t('inbox.settings.channels.appIdHint')" :error="appIdValue && !detailsValid ? t('inbox.settings.channels.invalid.app_id') : undefined">
              <UInput v-model="appId" class="w-full" dir="ltr" inputmode="numeric" autocomplete="off" :disabled="busy" data-testid="inbox-channel-edit-app-id" />
            </UFormField>
            <div class="flex justify-end">
              <UButton type="submit" :disabled="busy || !detailsDirty || !detailsValid" :loading="patching" :label="t('app.save')" />
            </div>
          </div>
        </SharedRecordSection>
      </form>

      <InboxChannelCommerceSection v-if="catalogOn && manage" :channel-id="channel.id" :manage="can('inbox.catalog.manage')" />

      <form v-if="manage" @submit.prevent="saveSecrets">
        <SharedRecordSection variant="panel" :title="t('inbox.settings.channels.secrets')" :description="t('inbox.settings.channels.secretsHint')">
          <div class="flex flex-col gap-4">
            <UFormField :label="t('inbox.settings.channels.accessToken')" :description="channel.has_access_token ? t('inbox.settings.channels.stored') : t('inbox.settings.channels.notStored')">
              <UInput v-model="accessToken" type="password" class="w-full" dir="ltr" autocomplete="off" :placeholder="t('inbox.settings.channels.replacePlaceholder')" :disabled="busy" />
            </UFormField>
            <UFormField :label="t('inbox.settings.channels.appSecret')" :description="channel.has_app_secret ? t('inbox.settings.channels.stored') : t('inbox.settings.channels.notStored')">
              <UInput v-model="appSecret" type="password" class="w-full" dir="ltr" autocomplete="off" :placeholder="t('inbox.settings.channels.replacePlaceholder')" :disabled="busy" />
            </UFormField>
            <div class="flex justify-end">
              <UButton type="submit" :disabled="busy || !secretsDirty || !secretsValid" :loading="patching" :label="t('inbox.settings.channels.replaceSecrets')" />
            </div>
          </div>
        </SharedRecordSection>
      </form>

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
        <SharedPropertyRow :label="t('inbox.settings.channels.kind')" :value="t('inbox.settings.channels.whatsapp')" />
        <SharedPropertyRow :label="t('inbox.settings.channels.phoneNumberId')"><bdi dir="ltr">{{ channel.phone_number_id }}</bdi></SharedPropertyRow>
        <SharedPropertyRow :label="t('inbox.settings.channels.businessAccountId')"><bdi dir="ltr">{{ channel.business_account_id }}</bdi></SharedPropertyRow>
        <SharedPropertyRow :label="t('inbox.settings.channels.department')" :value="channel.department?.name ?? t('inbox.settings.channels.noDepartment')" />
        <SharedPropertyRow :label="t('inbox.settings.channels.lastEvent')" :value="lastEvent" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
