<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { refDebounced } from '@vueuse/core'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import CommunicationMessageStatus from '@/components/settings/CommunicationMessageStatus.vue'
import { COMMUNICATION_PAGE_SIZE, useIntegrationMessages, useIntegrationSenders, useRetryMessage, type MessageFilters } from '@/composables/useIntegrationCommunications'
import { integrationErrorText } from '@/utils/integrationLabels'
import type { IntegrationMessage, IntegrationMessageChannel, IntegrationMessageState } from '@liwan/contracts'
import { MESSAGE_STATES, messageStage, messageStageTone } from '@/utils/integrationMessaging'

// The message log: every message the company sent through its messaging accounts, newest first, with the state each
// one reached. It holds customer numbers and message text, so the page renders this card only for a caller who holds
// `integrations.log.read` (a capability no built-in role carries) and the server enforces it again. A row opens its
// detail above the table; retrying a failed or unconfirmed message also needs integrations.manage (`canRetry`). The log
// is a snapshot: a deleted sender or account leaves its rows as they were.
const props = defineProps<{ canRetry: boolean }>()
const { t, te } = useI18n()
const hydrated = useHydrated()
const idBase = useId()
const CHANNELS: IntegrationMessageChannel[] = ['sms', 'whatsapp']

// The filter chips hold strings: '' is "all".
const channel = ref('')
const state = ref('')
const senderId = ref('')
const from = ref('')
const toDate = ref('')
const search = ref('')
const q = refDebounced(search, 300)
const page = ref(1)
watch([channel, state, senderId, from, toDate, q], () => { page.value = 1 })
const filters = computed<MessageFilters>(() => ({
  channel: (channel.value || undefined) as IntegrationMessageChannel | undefined,
  state: (state.value || undefined) as IntegrationMessageState | undefined,
  sender_id: senderId.value ? Number(senderId.value) : undefined,
  from: from.value || undefined,
  to_date: toDate.value || undefined,
  q: q.value.trim() || undefined,
  page: page.value,
}))
const activeCount = computed(() => [channel, state, senderId, from, toDate, search].filter(filter => Boolean(filter.value)).length)
function clearFilters() {
  for (const filter of [channel, state, senderId, from, toDate, search]) filter.value = ''
}

const messages = useIntegrationMessages(filters)
const rows = computed(() => messages.data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((messages.data.value?.total ?? 0) / COMMUNICATION_PAGE_SIZE)))
// The sender filter offers the active senders.
const senders = useIntegrationSenders({ active: true, page: 1 })
const senderItems = computed(() => [{ value: '', label: t('integrations.communications.log.filters.all') }, ...(senders.data.value?.items ?? []).map(sender => ({ value: String(sender.id), label: sender.value }))])

const retry = useRetryMessage()
const failure = ref('')
const openId = ref<number | null>(null)
const opened = computed(() => rows.value.find(row => row.id === openId.value) ?? null)
watch(rows, list => { if (openId.value !== null && !list.some(row => row.id === openId.value)) openId.value = null })
async function retryMessage(message: IntegrationMessage) {
  failure.value = ''
  try {
    await retry.mutateAsync(message.id)
    openId.value = null
  } catch (error) {
    failure.value = integrationErrorText(error, t)
  }
}

const channelLabel = (value: string) => (te(`integrations.communications.channel.${value}`) ? t(`integrations.communications.channel.${value}`) : value)
const stateLabel = (message: IntegrationMessage) => t(`integrations.communications.message.stage.${messageStage(message)}`)
const columns = computed<TableColumn<IntegrationMessage>[]>(() => [
  { accessorKey: 'created_at', header: t('integrations.communications.log.columns.time') },
  { accessorKey: 'to', header: t('integrations.communications.log.columns.to') },
  { accessorKey: 'channel', header: t('integrations.communications.log.columns.channel') },
  { accessorKey: 'sender_value', header: t('integrations.communications.log.columns.sender') },
  { accessorKey: 'state', header: t('integrations.communications.log.columns.state') },
  { id: 'actions', header: t('integrations.communications.log.columns.actions') },
])
</script>

<template>
  <SharedRecordSection id="log" variant="list" class="liwan-settings-anchor" :title="t('integrations.communications.log.title')" :description="t('integrations.communications.log.hint')" data-testid="communication-log">
    <div class="grid gap-3 p-(--liwan-card-pad-dense)">
      <SharedFilterBar :active-count="activeCount" @clear="clearFilters">
        <template #search>
          <UInput v-model="search" type="search" dir="ltr" icon="i-lucide-search" :placeholder="t('integrations.communications.log.search')" :aria-label="t('integrations.communications.log.search')" data-testid="communication-log-search" />
        </template>
        <SharedFilterChoice v-model="channel" :label="t('integrations.communications.log.filters.channel')" :items="[{ value: '', label: t('integrations.communications.log.filters.all') }, ...CHANNELS.map(item => ({ value: item, label: channelLabel(item) }))]" />
        <SharedFilterChoice v-model="state" :label="t('integrations.communications.log.filters.state')" :items="[{ value: '', label: t('integrations.communications.log.filters.all') }, ...MESSAGE_STATES.map(item => ({ value: item, label: t(`integrations.communications.message.stage.${item}`) }))]" />
        <SharedFilterChoice v-model="senderId" :label="t('integrations.communications.log.filters.sender')" :items="senderItems" />
        <SharedFilterField :label="t('integrations.communications.log.filters.from')" :for="`${idBase}-from`">
          <UInput :id="`${idBase}-from`" v-model="from" type="date" dir="ltr" :max="toDate || undefined" data-testid="communication-log-from" />
        </SharedFilterField>
        <SharedFilterField :label="t('integrations.communications.log.filters.toDate')" :for="`${idBase}-to`">
          <UInput :id="`${idBase}-to`" v-model="toDate" type="date" dir="ltr" :min="from || undefined" data-testid="communication-log-to" />
        </SharedFilterField>
        <template #actions>
          <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" :disabled="!hydrated || messages.isFetching.value" :loading="messages.isFetching.value" :label="t('integrations.communications.log.refresh')" data-testid="communication-log-refresh" @click="messages.refetch()" />
        </template>
      </SharedFilterBar>
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="communication-log-error" />
      <section v-if="opened" class="grid gap-3 rounded-card border border-default p-(--liwan-card-pad-dense) text-start" :aria-label="t('integrations.communications.log.detail')" data-testid="communication-log-detail">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-medium text-highlighted">{{ t('integrations.communications.log.detail') }}</h3>
          <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :label="t('integrations.communications.log.closeDetail')" @click="openId = null" />
        </div>
        <CommunicationMessageStatus :message="opened" :can-retry="canRetry" :retrying="retry.isPending.value" @retry="retryMessage(opened)" />
        <dl class="grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-6">
          <dt class="text-muted">{{ t('integrations.communications.log.columns.to') }}</dt>
          <dd><bdi dir="ltr">{{ opened.to }}</bdi></dd>
          <dt class="text-muted">{{ t('integrations.communications.log.columns.sender') }}</dt>
          <dd><bdi dir="ltr">{{ opened.sender_value }}</bdi> · {{ channelLabel(opened.channel) }}</dd>
          <dt class="text-muted">{{ t('integrations.communications.log.columns.time') }}</dt>
          <dd>{{ formatDateTime(opened.created_at) }}</dd>
          <template v-if="opened.sent_at">
            <dt class="text-muted">{{ t('integrations.communications.log.sentAt') }}</dt>
            <dd>{{ formatDateTime(opened.sent_at) }}</dd>
          </template>
          <template v-if="opened.read_at">
            <dt class="text-muted">{{ t('integrations.communications.log.readAt') }}</dt>
            <dd>{{ formatDateTime(opened.read_at) }}</dd>
          </template>
          <template v-if="opened.body">
            <dt class="text-muted">{{ t('integrations.communications.log.body') }}</dt>
            <dd class="min-w-0 whitespace-pre-wrap break-words"><bdi>{{ opened.body }}</bdi></dd>
          </template>
          <template v-if="opened.content_sid">
            <dt class="text-muted">{{ t('integrations.communications.log.template') }}</dt>
            <dd><bdi dir="ltr">{{ opened.content_sid }}</bdi></dd>
          </template>
          <template v-if="opened.segments">
            <dt class="text-muted">{{ t('integrations.communications.log.segments') }}</dt>
            <dd>{{ opened.segments }}</dd>
          </template>
        </dl>
      </section>
    </div>
    <SharedDataTable
      bare :rows="rows" :columns="columns" row-key="id" :page="page" :pages="pages"
      :caption="t('integrations.communications.log.title')" :loading="messages.isLoading.value" :error="messages.error.value"
      :empty-text="t(activeCount ? 'integrations.communications.log.emptyFiltered' : 'integrations.communications.log.empty')" empty-icon="i-lucide-messages-square"
      @update:page="page = $event" @retry="messages.refetch()"
    >
      <template #created_at-cell="{ row }">{{ formatDateTime(row.original.created_at) }}</template>
      <template #to-cell="{ row }"><bdi dir="ltr">{{ row.original.to }}</bdi></template>
      <template #channel-cell="{ row }">{{ channelLabel(row.original.channel) }}</template>
      <template #sender_value-cell="{ row }"><bdi dir="ltr">{{ row.original.sender_value }}</bdi></template>
      <template #state-cell="{ row }"><SharedStatusBadge :tone="messageStageTone(messageStage(row.original))" :label="stateLabel(row.original)" /></template>
      <template #actions-cell="{ row }">
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-panel-top-open" :aria-expanded="openId === row.original.id" :label="t('integrations.communications.log.open')" :data-testid="`communication-log-open-${row.original.id}`" @click="openId = row.original.id" />
      </template>
    </SharedDataTable>
  </SharedRecordSection>
</template>
