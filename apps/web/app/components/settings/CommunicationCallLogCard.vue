<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { refDebounced } from '@vueuse/core'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import CommunicationCallStatus from '@/components/settings/CommunicationCallStatus.vue'
import { COMMUNICATION_PAGE_SIZE, useIntegrationCalls, useIntegrationSenders, type CallFilters } from '@/composables/useIntegrationCommunications'
import type { IntegrationCall, IntegrationCallState } from '@liwan/contracts'
import { CALL_STATES, callDuration, callStageTone } from '@/utils/integrationVoice'

// The call log: every call the company placed through its communication accounts, newest first, with the state each
// one reached, its length and, when recording is on, the recording reference (never a player: only the reference is
// stored). It holds customer numbers, so the page renders this card only for a caller who holds
// `integrations.log.read` (a capability no built-in role carries) and the server enforces it again. A row opens its
// detail above the table. There is no retry: a call is never placed again automatically. The log is a snapshot: a
// deleted sender or account leaves its rows as they were.
const { t } = useI18n()
const hydrated = useHydrated()
const idBase = useId()

// The filter chips hold strings: '' is "all".
const state = ref('')
const senderId = ref('')
const from = ref('')
const toDate = ref('')
const search = ref('')
const q = refDebounced(search, 300)
const page = ref(1)
watch([state, senderId, from, toDate, q], () => { page.value = 1 })
const filters = computed<CallFilters>(() => ({
  state: (state.value || undefined) as IntegrationCallState | undefined,
  sender_id: senderId.value ? Number(senderId.value) : undefined,
  from: from.value || undefined,
  to_date: toDate.value || undefined,
  q: q.value.trim() || undefined,
  page: page.value,
}))
const activeCount = computed(() => [state, senderId, from, toDate, search].filter(filter => Boolean(filter.value)).length)
function clearFilters() {
  for (const filter of [state, senderId, from, toDate, search]) filter.value = ''
}

const calls = useIntegrationCalls(filters)
const rows = computed(() => calls.data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((calls.data.value?.total ?? 0) / COMMUNICATION_PAGE_SIZE)))
// The sender filter offers the active voice senders.
const senders = useIntegrationSenders({ channel: 'voice', active: true, page: 1 })
const senderItems = computed(() => [{ value: '', label: t('integrations.communications.log.filters.all') }, ...(senders.data.value?.items ?? []).map(sender => ({ value: String(sender.id), label: sender.value }))])

const openId = ref<number | null>(null)
const opened = computed(() => rows.value.find(row => row.id === openId.value) ?? null)
watch(rows, list => { if (openId.value !== null && !list.some(row => row.id === openId.value)) openId.value = null })

const columns = computed<TableColumn<IntegrationCall>[]>(() => [
  { accessorKey: 'created_at', header: t('integrations.communications.log.columns.time') },
  { accessorKey: 'to', header: t('integrations.communications.calls.columns.to') },
  { accessorKey: 'mode', header: t('integrations.communications.calls.columns.mode') },
  { accessorKey: 'from_value', header: t('integrations.communications.calls.columns.from') },
  { accessorKey: 'state', header: t('integrations.communications.log.columns.state') },
  { accessorKey: 'duration_seconds', header: t('integrations.communications.calls.columns.duration') },
  { id: 'actions', header: t('integrations.communications.log.columns.actions') },
])
const modeLabel = (mode: string) => t(`integrations.communications.voice.mode${mode === 'bridge' ? 'Bridge' : 'Speak'}`)
</script>

<template>
  <SharedRecordSection id="calls" variant="list" class="liwan-settings-anchor" :title="t('integrations.communications.calls.title')" :description="t('integrations.communications.calls.hint')" data-testid="communication-calls">
    <div class="grid gap-3 p-(--liwan-card-pad-dense)">
      <SharedFilterBar :active-count="activeCount" @clear="clearFilters">
        <template #search>
          <UInput v-model="search" type="search" dir="ltr" icon="i-lucide-search" :placeholder="t('integrations.communications.calls.search')" :aria-label="t('integrations.communications.calls.search')" data-testid="communication-calls-search" />
        </template>
        <SharedFilterChoice v-model="state" :label="t('integrations.communications.log.filters.state')" :items="[{ value: '', label: t('integrations.communications.log.filters.all') }, ...CALL_STATES.map(item => ({ value: item, label: t(`integrations.communications.call.stage.${item}`) }))]" />
        <SharedFilterChoice v-model="senderId" :label="t('integrations.communications.log.filters.sender')" :items="senderItems" />
        <SharedFilterField :label="t('integrations.communications.log.filters.from')" :for="`${idBase}-from`">
          <UInput :id="`${idBase}-from`" v-model="from" type="date" dir="ltr" :max="toDate || undefined" data-testid="communication-calls-from" />
        </SharedFilterField>
        <SharedFilterField :label="t('integrations.communications.log.filters.toDate')" :for="`${idBase}-to`">
          <UInput :id="`${idBase}-to`" v-model="toDate" type="date" dir="ltr" :min="from || undefined" data-testid="communication-calls-to" />
        </SharedFilterField>
        <template #actions>
          <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" :disabled="!hydrated || calls.isFetching.value" :loading="calls.isFetching.value" :label="t('integrations.communications.log.refresh')" data-testid="communication-calls-refresh" @click="calls.refetch()" />
        </template>
      </SharedFilterBar>
      <section v-if="opened" class="grid gap-3 rounded-card border border-default p-(--liwan-card-pad-dense) text-start" :aria-label="t('integrations.communications.calls.detail')" data-testid="communication-calls-detail">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-medium text-highlighted">{{ t('integrations.communications.calls.detail') }}</h3>
          <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :label="t('integrations.communications.log.closeDetail')" @click="openId = null" />
        </div>
        <CommunicationCallStatus :call="opened" />
        <dl class="grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-6">
          <dt class="text-muted">{{ t('integrations.communications.calls.columns.to') }}</dt>
          <dd><bdi dir="ltr">{{ opened.to }}</bdi></dd>
          <dt class="text-muted">{{ t('integrations.communications.calls.columns.from') }}</dt>
          <dd><bdi dir="ltr">{{ opened.from_value }}</bdi></dd>
          <template v-if="opened.mode === 'bridge' && opened.bridge_to">
            <dt class="text-muted">{{ t('integrations.communications.calls.agent') }}</dt>
            <dd><bdi dir="ltr">{{ opened.bridge_to }}</bdi></dd>
          </template>
          <template v-if="opened.speak_text">
            <dt class="text-muted">{{ t('integrations.communications.calls.spokenText') }}</dt>
            <dd class="min-w-0 whitespace-pre-wrap break-words"><bdi>{{ opened.speak_text }}</bdi></dd>
          </template>
          <dt class="text-muted">{{ t('integrations.communications.log.columns.time') }}</dt>
          <dd>{{ formatDateTime(opened.created_at) }}</dd>
          <template v-if="opened.started_at">
            <dt class="text-muted">{{ t('integrations.communications.calls.startedAt') }}</dt>
            <dd>{{ formatDateTime(opened.started_at) }}</dd>
          </template>
          <template v-if="opened.ended_at">
            <dt class="text-muted">{{ t('integrations.communications.calls.endedAt') }}</dt>
            <dd>{{ formatDateTime(opened.ended_at) }}</dd>
          </template>
          <dt class="text-muted">{{ t('integrations.communications.calls.columns.duration') }}</dt>
          <dd dir="ltr">{{ callDuration(opened.duration_seconds) ?? t('integrations.communications.calls.notYet') }}</dd>
          <template v-if="opened.recorded">
            <dt class="text-muted">{{ t('integrations.communications.calls.recording') }}</dt>
            <dd class="min-w-0">
              <span v-if="opened.recording_ref"><bdi dir="ltr">{{ opened.recording_ref }}</bdi><template v-if="opened.recording_duration_seconds"> · <bdi dir="ltr">{{ callDuration(opened.recording_duration_seconds) }}</bdi></template></span>
              <span v-else>{{ t('integrations.communications.calls.recordingPending') }}</span>
            </dd>
          </template>
        </dl>
      </section>
    </div>
    <SharedDataTable
      bare :rows="rows" :columns="columns" row-key="id" :page="page" :pages="pages"
      :caption="t('integrations.communications.calls.title')" :loading="calls.isLoading.value" :error="calls.error.value"
      :empty-text="t(activeCount ? 'integrations.communications.calls.emptyFiltered' : 'integrations.communications.calls.empty')" empty-icon="i-lucide-phone"
      @update:page="page = $event" @retry="calls.refetch()"
    >
      <template #created_at-cell="{ row }">{{ formatDateTime(row.original.created_at) }}</template>
      <template #to-cell="{ row }"><bdi dir="ltr">{{ row.original.to }}</bdi></template>
      <template #mode-cell="{ row }">{{ modeLabel(row.original.mode) }}</template>
      <template #from_value-cell="{ row }"><bdi dir="ltr">{{ row.original.from_value }}</bdi></template>
      <template #state-cell="{ row }">
        <SharedStatusBadge :tone="callStageTone(row.original.state)" :label="t(`integrations.communications.call.stage.${row.original.state}`)" />
      </template>
      <template #duration_seconds-cell="{ row }"><span dir="ltr">{{ callDuration(row.original.duration_seconds) ?? '—' }}</span></template>
      <template #actions-cell="{ row }">
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-panel-top-open" :aria-expanded="openId === row.original.id" :label="t('integrations.communications.log.open')" :data-testid="`communication-calls-open-${row.original.id}`" @click="openId = row.original.id" />
      </template>
    </SharedDataTable>
  </SharedRecordSection>
</template>
