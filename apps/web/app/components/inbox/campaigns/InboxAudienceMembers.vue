<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { InboxAudienceMember } from '@liwan/contracts'
import { CONSENT_STATES, CONSENT_TONE } from '@/composables/inbox/inboxCampaignPresentation'
import { CAMPAIGN_PAGE_SIZE, campaignPageOffset, parseMemberRoute, serializeMemberRoute, type MemberRoute } from '@/composables/inbox/inboxCampaignRoute'
import { useInboxAudienceMembers } from '@/composables/inbox/useInboxCampaigns'

// The contacts that match an audience right now, with their marketing consent, filtered by consent and name or number.
// The filters and the page live in the address.
const props = defineProps<{ audienceId: number }>()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const filters = computed(() => parseMemberRoute(route.query))
const list = useInboxAudienceMembers(() => props.audienceId, filters)
const items = computed(() => list.data.value?.items ?? [])
const total = computed(() => list.data.value?.total ?? 0)
const page = computed(() => Math.floor(filters.value.offset / CAMPAIGN_PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / CAMPAIGN_PAGE_SIZE)))
const activeCount = computed(() => [filters.value.consent, filters.value.q].filter(Boolean).length)

function setFilters(patch: Partial<MemberRoute>) {
  if (!hydrated.value) return
  void router.replace({ path: route.path, query: { ...route.query, consent: undefined, q: undefined, offset: undefined, ...serializeMemberRoute({ ...filters.value, offset: 0, ...patch }) } })
}
function setPage(next: number) {
  if (hydrated.value && !list.isFetching.value) setFilters({ offset: campaignPageOffset(next, total.value) })
}
const ALL = 'all'
const consentItems = computed(() => [{ value: ALL, label: t('inbox.campaigns.consent.all') }, ...CONSENT_STATES.map(value => ({ value, label: t(`inbox.campaigns.consent.${value}`) }))])
const columns = computed<TableColumn<InboxAudienceMember>[]>(() => [
  { accessorKey: 'name', header: t('inbox.settings.name') },
  { accessorKey: 'phone', header: t('inbox.panel.phone') },
  { accessorKey: 'consent', header: t('inbox.campaigns.consent.label'), meta: { class: { th: 'w-[140px]', td: 'w-[140px]' } } },
  { accessorKey: 'tags', header: t('inbox.panel.tags') },
])
</script>

<template>
  <SharedListCard data-testid="inbox-audience-members">
    <template #filters>
      <SharedFilterBar embedded class="w-full" :title="t('inbox.campaigns.audiences.members')" :active-count="activeCount" :disabled="!hydrated" @clear="setFilters({ consent: '', q: '' })">
        <template #search>
          <UInput
            :model-value="filters.q" class="min-w-48 flex-1" icon="i-lucide-search" :disabled="!hydrated"
            :aria-label="t('inbox.campaigns.audiences.searchMembers')" :placeholder="t('inbox.campaigns.audiences.searchMembers')" data-testid="inbox-members-search"
            @update:model-value="setFilters({ q: String($event ?? '').trim() })"
          />
        </template>
        <SharedFilterField :label="t('inbox.campaigns.consent.label')">
          <USelect :model-value="filters.consent || ALL" :items="consentItems" class="w-full" :disabled="!hydrated" data-testid="inbox-members-consent" @update:model-value="setFilters({ consent: $event === ALL ? '' : ($event as MemberRoute['consent']) })" />
        </SharedFilterField>
      </SharedFilterBar>
    </template>
    <SharedPageState :error="list.error.value" :keep-content="items.length > 0" @retry="list.refetch">
      <SharedEmptyState v-if="!list.isLoading.value && !items.length" class="m-(--liwan-card-pad-dense)" :title="t('inbox.campaigns.audiences.noMembers')" />
      <SharedDataTable v-else bare :rows="items" :columns="columns" row-key="id" :loading="list.isLoading.value" :caption="t('inbox.campaigns.audiences.members')">
        <template #name-cell="{ row }"><span class="font-medium text-highlighted">{{ row.original.name }}</span></template>
        <template #phone-cell="{ row }"><bdi v-if="row.original.phone" dir="ltr">{{ row.original.phone }}</bdi></template>
        <template #consent-cell="{ row }"><SharedStatusBadge size="sm" :tone="CONSENT_TONE[row.original.consent]" :label="t(`inbox.campaigns.consent.${row.original.consent}`)" /></template>
        <template #tags-cell="{ row }">
          <span class="flex flex-wrap gap-1"><SharedStatusBadge v-for="tag in row.original.tags" :key="tag.id" size="sm" tone="neutral" :label="tag.name" /></span>
        </template>
        <template #mobile-row="{ row }">
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-highlighted">{{ row.name }}</span>
            <SharedStatusBadge size="sm" :tone="CONSENT_TONE[row.consent]" :label="t(`inbox.campaigns.consent.${row.consent}`)" />
          </div>
          <bdi v-if="row.phone" dir="ltr" class="text-sm text-muted">{{ row.phone }}</bdi>
        </template>
      </SharedDataTable>
    </SharedPageState>
    <template v-if="list.data.value && total > 0" #footer>
      <SharedListFooter :count-label="t('inbox.campaigns.audiences.membersFooter', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="list.isFetching.value" count-test-id="inbox-members-count" @update:page="setPage" />
    </template>
  </SharedListCard>
</template>
