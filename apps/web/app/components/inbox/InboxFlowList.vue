<script setup lang="ts">
import InboxFlowState from '@/components/inbox/InboxFlowState.vue'
import { FLOW_STATUSES, flowsRoute } from '@/composables/inbox/inboxFlow'
import { useInboxChannelFlows } from '@/composables/inbox/useInboxFlows'

// The forms of one channel with their state and sending health, filtered by status and a name search kept in the
// address (`?status=&q=`), so a filtered list can be shared and survives refresh and back. An empty list explains what
// the Meta app must be subscribed to before status changes reach WebVue.
const props = defineProps<{ channelId: number }>()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const ALL = 'all'
const status = computed(() => {
  const value = route.query.status
  return typeof value === 'string' && (FLOW_STATUSES as readonly string[]).includes(value) ? value : ''
})
const committedSearch = computed(() => typeof route.query.q === 'string' ? route.query.q : '')
const search = ref(committedSearch.value)
watch(committedSearch, (value) => { search.value = value })

const query = useInboxChannelFlows(() => props.channelId, () => ({ status: status.value, q: committedSearch.value.trim(), limit: 200 }))
const items = computed(() => query.data.value?.items ?? [])
const filtered = computed(() => !!(status.value || committedSearch.value.trim()))
const statusItems = computed(() => [{ value: ALL, label: t('inbox.flows.filter.allStatuses') }, ...FLOW_STATUSES.map(value => ({ value, label: t(`inbox.flows.status.${value}`) }))])

function update(values: Record<string, string | undefined>) {
  if (!hydrated.value) return
  void router.replace({ path: route.path, query: { ...route.query, ...values } })
}
function clear() {
  search.value = ''
  update({ status: undefined, q: undefined })
}
</script>

<template>
  <SharedRecordSection id="flows" variant="list" :title="t('inbox.flows.title')" :description="t('inbox.flows.hint')">
    <template #actions>
      <UButton v-if="can('inbox.flows.manage')" :to="flowsRoute(props.channelId, route.query, '/new')" icon="i-lucide-plus" :disabled="!hydrated" :label="t('inbox.flows.create')" data-testid="inbox-flow-create" />
    </template>
    <div class="px-(--webvue-card-pad) py-3">
      <SharedFilterBar embedded class="w-full" :active-count="Number(!!status) + Number(!!committedSearch.trim())" :disabled="!hydrated" @clear="clear">
        <template #search>
          <form @submit.prevent="update({ q: search.trim() || undefined })">
            <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('inbox.flows.filter.search')" :aria-label="t('inbox.flows.filter.search')" :disabled="!hydrated" data-testid="inbox-flow-search" @blur="update({ q: search.trim() || undefined })" />
          </form>
        </template>
        <USelect :model-value="status || ALL" :items="statusItems" :aria-label="t('inbox.flows.filter.status')" :disabled="!hydrated" data-testid="inbox-flow-filter-status" @update:model-value="update({ status: $event === ALL ? undefined : String($event) })" />
      </SharedFilterBar>
    </div>
    <SharedLoadingSkeleton v-if="query.isPending.value" class="m-4" />
    <SharedPageState v-else-if="query.error.value" class="m-4" :error="query.error.value" @retry="query.refetch()" />
    <div v-else-if="!items.length" class="flex flex-col gap-2 px-(--webvue-card-pad) py-4 text-sm text-muted" data-testid="inbox-flows-empty">
      <p>{{ filtered ? t('app.noResults') : t('inbox.flows.empty') }}</p>
      <p v-if="!filtered" class="text-xs">{{ t('inbox.flows.webhookGuidance') }}</p>
    </div>
    <template v-else>
      <NuxtLink
        v-for="flow in items"
        :key="flow.id"
        :to="flowsRoute(props.channelId, route.query, `/${flow.id}`)"
        class="flex flex-col gap-1.5 px-(--webvue-card-pad) py-3 text-start transition-colors duration-150 hover:bg-(--webvue-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
        :data-testid="`inbox-flow-${flow.id}`"
      >
        <span class="flex flex-wrap items-center justify-between gap-3">
          <span class="flex min-w-0 items-center gap-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UIcon name="i-lucide-clipboard-list" class="size-5" aria-hidden="true" /></span>
            <span class="min-w-0">
              <bdi class="block truncate text-sm font-medium text-highlighted">{{ flow.name }}</bdi>
              <span class="block truncate text-xs text-muted">{{ t(`inbox.flows.category.${flow.category}`) }} · <bdi dir="ltr">{{ flow.language }}</bdi><template v-if="can('inbox.conversations.read')"> · {{ t('inbox.flows.submissionCount', { n: flow.submission_count }) }}</template></span>
            </span>
          </span>
          <span class="flex flex-wrap items-center gap-2">
            <SharedStatusBadge v-if="flow.error_count > 0" size="sm" tone="destructive" :label="t('inbox.flows.errorCount', { n: flow.error_count })" data-testid="inbox-flow-errors-badge" />
            <SharedStatusBadge v-if="flow.version_warning" size="sm" tone="warning" :label="t('inbox.flows.versionWarning')" data-testid="inbox-flow-version-badge" />
            <InboxFlowState :flow="flow" />
            <UIcon name="i-lucide-chevron-right" class="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
          </span>
        </span>
        <span v-if="flow.version_warning" class="ps-12 text-xs text-warning"><bdi>{{ flow.version_warning }}</bdi></span>
      </NuxtLink>
    </template>
  </SharedRecordSection>
</template>
