<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { IntegrationConnection, IntegrationSender, IntegrationSenderChannel } from '@liwan/contracts'
import { useIntegrationConnections } from '@/composables/useIntegrationConnections'
import { useIntegrationProviders } from '@/composables/useIntegrationProviders'
import { COMMUNICATION_PAGE_SIZE, useArchiveIntegrationSender, useIntegrationSenders, useUpdateIntegrationSender, type SenderFilters } from '@/composables/useIntegrationCommunications'
import { integrationErrorText, integrationProviderLabel } from '@/utils/integrationLabels'
import { providerHasSenders } from '@/utils/integrationMessaging'
import { providerHasVoice } from '@/utils/integrationVoice'

// The senders of the company's messaging accounts: the numbers, sender names and services a message goes out from,
// and the voice numbers a call goes out from. The channel list follows the provider: the voice channel appears only
// when a connected provider declares its voice use. The card names what is missing before it lists anything: no
// messaging account, an account that is off or refused by the provider, and a channel with no active sender. A
// sender is added in the route-backed create panel; here it is made the default, archived (DELETE) or brought back.
// Every answer replaces the cached sender, so the card shows what the server holds. Reading needs integrations.read;
// every action needs integrations.manage (`canManage`).
const props = defineProps<{ canManage: boolean }>()
const { t, te } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const CREATE_PATH = '/settings/integrations/communications/senders/new'

const connections = useIntegrationConnections()
const providers = useIntegrationProviders()
// A connection holds senders when its provider offers messaging or voice; an account an application alone uses (WhatsApp through Meta) does not.
const accounts = computed<IntegrationConnection[]>(() => {
  const codes = new Set((providers.data.value?.items ?? []).filter(providerHasSenders).map(provider => provider.code))
  return (connections.data.value?.items ?? []).filter(connection => connection.id !== null && codes.has(connection.provider))
})
const accountsReady = computed(() => connections.isSuccess.value && providers.isSuccess.value)
const loadError = computed(() => connections.error.value ?? providers.error.value)
const hasAccounts = computed(() => accounts.value.length > 0)
const connectedAccounts = computed(() => accounts.value.filter(account => account.state === 'connected'))
const unready = computed(() => accounts.value.filter(account => account.state !== 'connected'))
// The voice channel exists only when a provider of a connected account declares its voice use.
const hasVoice = computed(() => (providers.data.value?.items ?? []).some(providerHasVoice))
const CHANNELS = computed<IntegrationSenderChannel[]>(() => (hasVoice.value ? ['sms', 'whatsapp', 'voice'] : ['sms', 'whatsapp']))

// The filter chips hold strings: '' is "all", `view` is 'active' or 'archived'.
const channelFilter = ref('')
const connectionFilter = ref('')
const view = ref('active')
const page = ref(1)
watch([channelFilter, connectionFilter, view], () => { page.value = 1 })
const filters = computed<SenderFilters>(() => ({
  channel: (channelFilter.value || undefined) as IntegrationSenderChannel | undefined,
  connection_id: connectionFilter.value ? Number(connectionFilter.value) : undefined,
  active: view.value === 'active',
  page: page.value,
}))
const senders = useIntegrationSenders(filters, hasAccounts)
const rows = computed(() => senders.data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((senders.data.value?.total ?? 0) / COMMUNICATION_PAGE_SIZE)))
const activeCount = computed(() => Number(Boolean(channelFilter.value)) + Number(Boolean(connectionFilter.value)) + Number(view.value === 'archived'))
function clearFilters() {
  channelFilter.value = ''
  connectionFilter.value = ''
  view.value = 'active'
}

// One read per channel says whether it has any active sender, whatever the table is filtered to. Each composable is
// called once at setup (a query observer per channel, never recreated): the sms and whatsapp reads wait for a
// connected account, and the voice read also waits for `hasVoice`, so a provider without voice holds no voice query.
const perChannel: Record<IntegrationSenderChannel, ReturnType<typeof useIntegrationSenders>> = {
  sms: useIntegrationSenders({ channel: 'sms', active: true, page: 1 }, () => connectedAccounts.value.length > 0),
  whatsapp: useIntegrationSenders({ channel: 'whatsapp', active: true, page: 1 }, () => connectedAccounts.value.length > 0),
  voice: useIntegrationSenders({ channel: 'voice', active: true, page: 1 }, () => hasVoice.value && connectedAccounts.value.length > 0),
}
const channelsWithoutSender = computed(() => (connectedAccounts.value.length ? CHANNELS.value.filter(channel => perChannel[channel].isSuccess.value && perChannel[channel].data.value?.total === 0) : []))

const update = useUpdateIntegrationSender()
const archive = useArchiveIntegrationSender()
const working = computed(() => update.isPending.value || archive.isPending.value)
const locked = computed(() => !hydrated.value || !props.canManage || working.value)
const failure = ref('')
const archiving = ref<IntegrationSender | null>(null)

async function run(task: () => Promise<void>) {
  if (locked.value) return
  failure.value = ''
  try { await task() } catch (error) { failure.value = integrationErrorText(error, t) }
}
const makeDefault = (sender: IntegrationSender) => run(async () => {
  await update.mutateAsync({ id: sender.id, body: { is_default: true } })
  toast.add({ title: t('integrations.communications.senders.defaultSet'), color: 'success' })
})
const restore = (sender: IntegrationSender) => run(async () => {
  await update.mutateAsync({ id: sender.id, body: { active: true } })
  toast.add({ title: t('integrations.communications.senders.restored'), color: 'success' })
})
const confirmArchive = () => run(async () => {
  const sender = archiving.value
  if (!sender) return
  try { await archive.mutateAsync(sender.id) } finally { archiving.value = null }
  toast.add({ title: t('integrations.communications.senders.archived'), color: 'success' })
})

const channelLabel = (channel: string) => (te(`integrations.communications.channel.${channel}`) ? t(`integrations.communications.channel.${channel}`) : channel)
const kindLabel = (kind: string) => (te(`integrations.communications.kind.${kind}`) ? t(`integrations.communications.kind.${kind}`) : kind)
const accountLabel = (id: number) => {
  const account = accounts.value.find(item => item.id === id)
  return account ? account.label || integrationProviderLabel(account.provider, t, te) : String(id)
}
const noticeKey = (account: IntegrationConnection) => (account.state === 'disabled' ? 'disabled' : account.state === 'error' ? 'error' : 'pending')
const columns = computed<TableColumn<IntegrationSender>[]>(() => [
  { accessorKey: 'value', header: t('integrations.communications.senders.columns.sender') },
  { accessorKey: 'channel', header: t('integrations.communications.senders.columns.channel') },
  { accessorKey: 'connection_id', header: t('integrations.communications.senders.columns.account') },
  { accessorKey: 'is_default', header: t('integrations.communications.senders.columns.default') },
  { id: 'actions', header: t('integrations.communications.senders.columns.actions') },
])
</script>

<template>
  <SharedRecordSection id="senders" variant="list" class="liwan-settings-anchor" :title="t('integrations.communications.senders.title')" :description="t('integrations.communications.senders.hint')" data-testid="communication-senders">
    <template v-if="canManage && connectedAccounts.length" #actions>
      <UButton :to="CREATE_PATH" color="primary" icon="i-lucide-plus" :label="t('integrations.communications.senders.add')" data-testid="communication-sender-add" />
    </template>
    <SharedPageState empty-icon="i-lucide-message-square-text" :loading="connections.isLoading.value || providers.isLoading.value" :error="loadError" :empty="accountsReady && !hasAccounts" :empty-text="t('integrations.communications.senders.noAccount')" :empty-description="t('integrations.communications.senders.noAccountHint')" @retry="connections.refetch(); providers.refetch()">
      <template #emptyAction>
        <UButton to="/settings/integrations#providers" color="neutral" variant="outline" :label="t('integrations.communications.senders.connectAccount')" data-testid="communication-connect-account" />
      </template>
      <div class="grid gap-3 p-(--liwan-card-pad-dense)">
        <UAlert
          v-for="account in unready" :key="account.ref"
          role="status" :color="account.state === 'error' ? 'error' : 'warning'" variant="subtle" :icon="account.state === 'error' ? 'i-lucide-circle-alert' : 'i-lucide-circle-pause'"
          :title="t(`integrations.communications.senders.account.${noticeKey(account)}`, { account: accountLabel(account.id as number) })"
          :description="account.status_message || t(`integrations.communications.senders.account.${noticeKey(account)}Hint`)"
          :actions="[{ label: t('integrations.communications.senders.openAccount'), to: `/settings/integrations/connections/${account.id}`, color: 'neutral', variant: 'outline' }]"
          :data-testid="`communication-account-${noticeKey(account)}`"
        />
        <UAlert
          v-for="channel in channelsWithoutSender" :key="channel"
          role="status" color="warning" variant="subtle" icon="i-lucide-message-square-warning"
          :title="t('integrations.communications.senders.noSender', { channel: channelLabel(channel) })"
          :description="t('integrations.communications.senders.noSenderHint')"
          :data-testid="`communication-no-sender-${channel}`"
        />
        <SharedFilterBar v-if="connectedAccounts.length || rows.length || activeCount" :active-count="activeCount" @clear="clearFilters">
          <SharedFilterChoice v-model="channelFilter" :label="t('integrations.communications.senders.filters.channel')" :items="[{ value: '', label: t('integrations.communications.senders.filters.all') }, ...CHANNELS.map(channel => ({ value: channel, label: channelLabel(channel) }))]" />
          <SharedFilterChoice v-if="accounts.length > 1" v-model="connectionFilter" :label="t('integrations.communications.senders.filters.account')" :items="[{ value: '', label: t('integrations.communications.senders.filters.all') }, ...accounts.map(account => ({ value: String(account.id), label: accountLabel(account.id as number) }))]" />
          <SharedFilterChoice v-model="view" :label="t('integrations.communications.senders.filters.status')" :items="[{ value: 'active', label: t('integrations.communications.senders.filters.active') }, { value: 'archived', label: t('integrations.communications.senders.filters.archived') }]" />
        </SharedFilterBar>
        <SharedInlineConfirm
          v-if="archiving"
          :title="t('integrations.communications.senders.confirmArchiveTitle', { sender: archiving.value })"
          :description="t('integrations.communications.senders.confirmArchiveDescription')"
          :confirm-label="t('integrations.communications.senders.confirmArchive')"
          :pending="archive.isPending.value"
          @confirm="confirmArchive"
          @cancel="archiving = null"
        />
        <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="communication-sender-error" />
      </div>
      <SharedDataTable
        bare :rows="rows" :columns="columns" row-key="id" :page="page" :pages="pages"
        :caption="t('integrations.communications.senders.title')" :loading="senders.isLoading.value" :error="senders.error.value"
        :empty-text="t(view === 'archived' ? 'integrations.communications.senders.emptyArchived' : 'integrations.communications.senders.empty')" empty-icon="i-lucide-message-square-text"
        @update:page="page = $event" @retry="senders.refetch()"
      >
        <template #value-cell="{ row }">
          <div class="grid min-w-0 gap-0.5">
            <bdi class="font-medium text-highlighted" dir="ltr">{{ row.original.value }}</bdi>
            <span class="text-xs text-muted">{{ kindLabel(row.original.kind) }}</span>
          </div>
        </template>
        <template #channel-cell="{ row }">{{ channelLabel(row.original.channel) }}</template>
        <template #connection_id-cell="{ row }"><bdi>{{ accountLabel(row.original.connection_id) }}</bdi></template>
        <template #is_default-cell="{ row }">
          <SharedStatusBadge v-if="row.original.is_default && row.original.active" tone="success" :label="t('integrations.communications.senders.isDefault')" />
          <SharedStatusBadge v-else-if="!row.original.active" tone="neutral" :label="t('integrations.communications.senders.isArchived')" />
        </template>
        <template #actions-cell="{ row }">
          <div v-if="canManage" class="flex flex-wrap items-center gap-2">
            <template v-if="row.original.active">
              <UButton v-if="!row.original.is_default" size="sm" color="neutral" variant="outline" icon="i-lucide-star" :disabled="locked" :label="t('integrations.communications.senders.makeDefault')" :data-testid="`communication-sender-default-${row.original.id}`" @click="makeDefault(row.original)" />
              <UButton size="sm" color="error" variant="outline" icon="i-lucide-archive" :disabled="locked || archiving !== null" :label="t('integrations.communications.senders.archive')" :data-testid="`communication-sender-archive-${row.original.id}`" @click="archiving = row.original" />
            </template>
            <UButton v-else size="sm" color="neutral" variant="outline" icon="i-lucide-archive-restore" :disabled="locked" :label="t('integrations.communications.senders.restore')" :data-testid="`communication-sender-restore-${row.original.id}`" @click="restore(row.original)" />
          </div>
        </template>
      </SharedDataTable>
    </SharedPageState>
  </SharedRecordSection>
</template>
