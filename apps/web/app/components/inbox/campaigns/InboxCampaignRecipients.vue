<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { InboxCampaignRecipient } from '@webvue/contracts'
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import { RECIPIENT_STATE_TONE, RECIPIENT_STATES } from '@/composables/inbox/inboxCampaignPresentation'
import {
  CAMPAIGN_PAGE_SIZE, campaignPageOffset, parseRecipientRoute, serializeRecipientRoute, type RecipientRoute,
} from '@/composables/inbox/inboxCampaignRoute'
import { useInboxCampaignRecipients } from '@/composables/inbox/useInboxCampaigns'

// The recipients of one campaign with their own state, the reason for a skip or a failure (with Meta's code), replies and
// unsubscribes. The filters and the page live in the address. The table refreshes with the campaign while it runs.
const props = defineProps<{ campaignId: number; poll: boolean; canOpenConversation: boolean }>()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()

const filters = computed(() => parseRecipientRoute(route.query))
const list = useInboxCampaignRecipients(() => props.campaignId, filters, () => props.poll)
const items = computed(() => list.data.value?.items ?? [])
const total = computed(() => list.data.value?.total ?? 0)
const page = computed(() => Math.floor(filters.value.offset / CAMPAIGN_PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / CAMPAIGN_PAGE_SIZE)))
const activeCount = computed(() => [filters.value.state, filters.value.failure, filters.value.q].filter(Boolean).length)

function setFilters(patch: Partial<RecipientRoute>) {
  if (!hydrated.value) return
  void router.replace({ path: route.path, query: { ...route.query, state: undefined, failure: undefined, q: undefined, offset: undefined, ...serializeRecipientRoute({ ...filters.value, offset: 0, ...patch }) } })
}
function setPage(next: number) {
  if (hydrated.value && !list.isFetching.value) setFilters({ offset: campaignPageOffset(next, total.value) })
}

const ALL = 'all'
const FAILURES = ['frequency_capped', 'marketing_opt_out', 'not_on_whatsapp', 'template_unavailable', 'invalid_params', 'experiment', 'account_restricted', 'other'] as const
const stateItems = computed(() => [{ value: ALL, label: t('inbox.campaigns.filters.allStates') }, ...RECIPIENT_STATES.map(value => ({ value, label: t(`inbox.campaigns.recipients.states.${value}`) }))])
const failureItems = computed(() => [{ value: ALL, label: t('inbox.campaigns.recipients.allFailures') }, ...FAILURES.map(value => ({ value, label: t(`inbox.campaigns.recipients.failure.${value}`) }))])

const columns = computed<TableColumn<InboxCampaignRecipient>[]>(() => [
  { accessorKey: 'contact', header: t('inbox.campaigns.recipients.contact') },
  { accessorKey: 'state', header: t('inbox.campaigns.columns.state'), meta: { class: { th: 'w-[130px]', td: 'w-[130px]' } } },
  { accessorKey: 'error', header: t('inbox.campaigns.recipients.detail') },
  { accessorKey: 'sent_at', header: t('inbox.campaigns.recipients.sentAt'), meta: { class: { th: 'w-[160px]', td: 'w-[160px]' } } },
  { accessorKey: 'replied_at', header: t('inbox.campaigns.recipients.response'), meta: { class: { th: 'w-[150px]', td: 'w-[150px]' } } },
  { accessorKey: 'id', header: '', meta: { class: { th: 'w-[110px]', td: 'w-[110px]' } } },
])
const detailOf = (row: InboxCampaignRecipient) => row.skip_reason
  ? t(`inbox.campaigns.recipients.skip.${row.skip_reason}`)
  : row.failure ? t(`inbox.campaigns.recipients.failure.${row.failure}`) : ''
</script>

<template>
  <SharedListCard data-testid="inbox-campaign-recipients">
    <template #filters>
      <SharedFilterBar embedded class="w-full" :title="t('inbox.campaigns.recipients.title')" :active-count="activeCount" :disabled="!hydrated" @clear="setFilters({ state: '', failure: '', q: '' })">
        <template #search>
          <UInput
            :model-value="filters.q" class="min-w-48 flex-1" icon="i-lucide-search" :disabled="!hydrated"
            :aria-label="t('inbox.campaigns.recipients.search')" :placeholder="t('inbox.campaigns.recipients.search')" data-testid="inbox-recipients-search"
            @update:model-value="setFilters({ q: String($event ?? '').trim() })"
          />
        </template>
        <SharedFilterField :label="t('inbox.campaigns.columns.state')">
          <USelect :model-value="filters.state || ALL" :items="stateItems" class="w-full" :disabled="!hydrated" data-testid="inbox-recipients-state" @update:model-value="setFilters({ state: $event === ALL ? '' : ($event as RecipientRoute['state']) })" />
        </SharedFilterField>
        <SharedFilterField :label="t('inbox.campaigns.recipients.failureLabel')">
          <USelect :model-value="filters.failure || ALL" :items="failureItems" class="w-full" :disabled="!hydrated" data-testid="inbox-recipients-failure" @update:model-value="setFilters({ failure: $event === ALL ? '' : ($event as RecipientRoute['failure']) })" />
        </SharedFilterField>
      </SharedFilterBar>
    </template>

    <SharedPageState :error="list.error.value" :keep-content="items.length > 0" @retry="list.refetch">
      <SharedEmptyState v-if="!list.isLoading.value && !items.length" class="m-(--webvue-card-pad-dense)" :title="t('inbox.campaigns.recipients.empty')" />
      <SharedDataTable v-else bare :rows="items" :columns="columns" row-key="id" :loading="list.isLoading.value" :caption="t('inbox.campaigns.recipients.title')">
        <template #contact-cell="{ row }">
          <span class="flex min-w-0 flex-col">
            <span class="truncate font-medium text-highlighted">{{ row.original.contact.name }}</span>
            <bdi v-if="row.original.contact.phone" dir="ltr" class="text-xs text-muted">{{ row.original.contact.phone }}</bdi>
          </span>
        </template>
        <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="RECIPIENT_STATE_TONE[row.original.state]" :label="t(`inbox.campaigns.recipients.states.${row.original.state}`)" :data-testid="`inbox-recipient-state-${row.original.id}`" /></template>
        <template #error-cell="{ row }">
          <span class="flex min-w-0 flex-col text-sm">
            <span>{{ detailOf(row.original) }}</span>
            <span v-if="row.original.error" class="truncate text-xs text-muted"><bdi v-if="row.original.error_code" dir="ltr">{{ row.original.error_code }}</bdi> {{ row.original.error }}</span>
          </span>
        </template>
        <template #sent_at-cell="{ row }"><time v-if="row.original.sent_at" class="text-sm" :datetime="row.original.sent_at">{{ formatDateTime(row.original.sent_at) }}</time></template>
        <template #replied_at-cell="{ row }">
          <span class="flex flex-wrap gap-1">
            <SharedStatusBadge v-if="row.original.replied_at" size="sm" tone="success" :label="t('inbox.campaigns.recipients.replied')" />
            <SharedStatusBadge v-if="row.original.unsubscribed_at" size="sm" tone="warning" :label="t('inbox.campaigns.recipients.unsubscribed')" />
          </span>
        </template>
        <template #id-cell="{ row }">
          <UButton v-if="props.canOpenConversation && row.original.conversation_id" :to="`/inbox/${row.original.conversation_id}`" size="xs" color="neutral" variant="ghost" icon="i-lucide-message-square" :label="t('inbox.campaigns.recipients.open')" />
        </template>
        <template #mobile-row="{ row }">
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-highlighted">{{ row.contact.name }}</span>
            <SharedStatusBadge size="sm" :tone="RECIPIENT_STATE_TONE[row.state]" :label="t(`inbox.campaigns.recipients.states.${row.state}`)" />
          </div>
          <p class="mt-1 text-sm text-muted">{{ detailOf(row) }}</p>
        </template>
      </SharedDataTable>
    </SharedPageState>
    <template v-if="list.data.value && total > 0" #footer>
      <SharedListFooter :count-label="t('inbox.campaigns.recipients.footer', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="list.isFetching.value" count-test-id="inbox-recipients-count" @update:page="setPage" />
    </template>
  </SharedListCard>
</template>
