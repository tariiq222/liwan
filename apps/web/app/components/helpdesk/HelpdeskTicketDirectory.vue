<script setup lang="ts">
import type { HelpdeskTicketRow } from '@liwan/contracts'
import { HELPDESK_LIST_KEYS, HELPDESK_LIST_PATH, HELPDESK_PAGE_SIZE, parseHelpdeskListQuery } from '@/composables/helpdesk/helpdeskKeys'
import { useHelpdeskReference, useHelpdeskTickets } from '@/composables/helpdesk/useHelpdesk'
import { listLocation, safeListReturnTo, useLastPageClamp, useRouteListFilters } from '@/composables/useRouteListFilters'
import HelpdeskTicketTable from './HelpdeskTicketTable.vue'

// The body of the support list: the queue chips, the filters (search, team, stage, priority, assignee) and the table in
// one card with its pager. The filters live in the URL query, so a record and the browser's Back return to the same list.
// `background` is the list behind the create panel: it reads its filters from the panel's returnTo.
const props = defineProps<{ background?: boolean }>()
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const { hydrated, filterQuery, search, update } = useRouteListFilters({
  background: () => props.background,
  fallbackPath: () => HELPDESK_LIST_PATH,
  safeReturnTo: value => safeListReturnTo(HELPDESK_LIST_PATH, value),
})
const state = computed(() => parseHelpdeskListQuery(filterQuery.value))
const query = useHelpdeskTickets(state)
const reference = useHelpdeskReference()
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / HELPDESK_PAGE_SIZE)))
useLastPageClamp({ page: () => state.value.page, total: () => query.data.value?.total, pageSize: HELPDESK_PAGE_SIZE })
const backTo = computed(() => listLocation(HELPDESK_LIST_PATH, HELPDESK_LIST_KEYS, filterQuery.value, route.hash))
const recordTo = (ticket: HelpdeskTicketRow) => ({ path: `${HELPDESK_LIST_PATH}/${ticket.id}`, query: { returnTo: backTo.value } })
const activeCount = computed(() => Number(Boolean(state.value.q)) + Number(state.value.team !== null)
  + Number(state.value.stage !== null) + Number(state.value.priority !== null) + Number(state.value.assignee !== null))

const queueItems = computed(() => [
  { value: 'open', label: t('helpdesk.queue.open') },
  { value: 'closed', label: t('helpdesk.queue.closed') },
  { value: 'all', label: t('helpdesk.queue.all') },
])
const teamItems = computed(() => [
  { value: 0, label: t('helpdesk.filters.anyTeam') },
  ...(reference.data.value?.teams ?? []).map(team => ({ value: team.id, label: team.name })),
])
const stageItems = computed(() => [
  { value: 0, label: t('helpdesk.filters.anyStage') },
  ...(reference.data.value?.stages ?? []).map(stage => ({ value: stage.id, label: stage.name })),
])
const priorityItems = computed(() => [
  { value: '', label: t('helpdesk.filters.anyPriority') },
  ...(['urgent', 'high', 'medium', 'low'] as const).map(value => ({ value, label: t(`helpdesk.priority.${value}`) })),
])
const assigneeItems = computed(() => [
  { value: 'any', label: t('helpdesk.filters.anyAssignee') },
  { value: 'me', label: t('helpdesk.filters.mine') },
  { value: 'none', label: t('helpdesk.filters.unassigned') },
])
function setQueue(value: string) {
  void update({ state: value === 'open' ? undefined : value, page: undefined })
}
function clearFilters() {
  search.value = ''
  void update({ q: undefined, team: undefined, stage: undefined, priority: undefined, assignee: undefined, page: undefined })
}
const emptyText = computed(() => t(activeCount.value ? 'app.noResults' : 'helpdesk.empty'))
</script>

<template>
  <SharedForbiddenState v-if="!can('helpdesk.tickets.read') && !can('helpdesk.requests.read')" />
  <div v-else class="flex min-w-0 flex-col gap-4">
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :disabled="!hydrated" @clear="clearFilters">
          <template #view>
            <SharedSegmentedControl data-testid="helpdesk-queue" :label="t('helpdesk.queue.label')" :items="queueItems" :model-value="state.state" @update:model-value="setQueue" />
          </template>
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('helpdesk.search')" :aria-label="t('helpdesk.search')" :disabled="!hydrated" data-testid="helpdesk-search" />
            </form>
          </template>
          <USelect :model-value="state.team ?? 0" :items="teamItems" :aria-label="t('helpdesk.columns.team')" :disabled="!hydrated" data-testid="helpdesk-team" @update:model-value="value => update({ team: Number(value) > 0 ? String(value) : undefined, page: undefined })" />
          <USelect :model-value="state.stage ?? 0" :items="stageItems" :aria-label="t('helpdesk.columns.stage')" :disabled="!hydrated" data-testid="helpdesk-stage" @update:model-value="value => update({ stage: Number(value) > 0 ? String(value) : undefined, page: undefined })" />
          <USelect :model-value="state.priority ?? ''" :items="priorityItems" :aria-label="t('helpdesk.columns.priority')" :disabled="!hydrated" data-testid="helpdesk-priority" @update:model-value="value => update({ priority: value ? String(value) : undefined, page: undefined })" />
          <USelect :model-value="state.assignee ?? 'any'" :items="assigneeItems" :aria-label="t('helpdesk.columns.assignee')" :disabled="!hydrated" data-testid="helpdesk-assignee" @update:model-value="value => update({ assignee: value === 'any' ? undefined : String(value), page: undefined })" />
        </SharedFilterBar>
      </template>
      <SharedPageState v-if="query.error.value && !query.data.value" :error="query.error.value" @retry="query.refetch()" />
      <SharedEmptyState v-else-if="!query.isPending.value && !items.length" class="m-(--liwan-card-pad-dense)" :title="emptyText">
        <template v-if="activeCount" #action><UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('helpdesk.clear')" @click="clearFilters" /></template>
      </SharedEmptyState>
      <HelpdeskTicketTable v-else :rows="items" :loading="query.isPending.value" :error="null" :record-to="recordTo" @retry="query.refetch()" />
      <template v-if="query.data.value && items.length" #footer>
        <SharedListFooter :count-label="t('helpdesk.footer', { shown: items.length, total }, total)" :page="state.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
