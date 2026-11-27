<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { useQuery } from '@tanstack/vue-query'
import type { TelephonyCall } from '@liwan/contracts'
import { TelephonyCallDirectionSchema, TelephonyCallListSchema, TelephonyCallStateSchema } from '@liwan/contracts'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { callDuration, callNumber, callTime } from '@/components/telephony/callPresentation'
import { firstQuery, lastPageOffset, parseOffset } from '@/utils/routeQuery'

/**
 * The call log: each call with its number and the customer it belongs to, the employee who took it, when it started
 * and how long it lasted. The direction, the state and the page live in the URL, and every row opens its call with
 * this exact address, so the call's back link returns to the same filters and page.
 */
const PAGE_SIZE = 25
const ALL = 'all'
const DIRECTIONS = TelephonyCallDirectionSchema.options
const STATES = TelephonyCallStateSchema.options

const { t } = useI18n()
const { $api } = useApi()
const route = useRoute()
const router = useRouter()
const hydrated = useHydrated()
const { me } = useMe()

/** The choice the URL names when the contract knows it; anything else reads as no filter. */
function routeChoice<T extends string>(choices: readonly T[], value: unknown): T | undefined {
  const raw = firstQuery(value)
  return choices.find(choice => choice === raw)
}
const direction = computed(() => routeChoice(DIRECTIONS, route.query.direction))
const state = computed(() => routeChoice(STATES, route.query.state))
// An offset that falls between two pages lands on the page it is in.
const offset = computed(() => Math.floor(parseOffset(route.query.offset) / PAGE_SIZE) * PAGE_SIZE)
const timeZone = computed(() => me.value?.tz)

const calls = useQuery({
  queryKey: ['telephony', 'calls', direction, state, offset],
  queryFn: ({ signal }) => $api('/api/v1/telephony/calls', {
    query: { direction: direction.value, state: state.value, limit: PAGE_SIZE, offset: offset.value },
    schema: TelephonyCallListSchema,
    signal,
  }),
})

const items = computed(() => calls.data.value?.items ?? [])
const total = computed(() => calls.data.value?.total ?? 0)
const page = computed(() => offset.value / PAGE_SIZE + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const activeFilterCount = computed(() => Number(Boolean(direction.value)) + Number(Boolean(state.value)))

const directionItems = computed(() => [{ value: ALL, label: t('telephony.filter.all') }, ...DIRECTIONS.map(value => ({ value, label: t(`telephony.direction.${value}`) }))])
const stateItems = computed(() => [{ value: ALL, label: t('telephony.filter.allStates') }, ...STATES.map(value => ({ value, label: t(`telephony.state.${value}`) }))])

function writeQuery(patch: Record<string, string | null | undefined>) {
  void router.replace({ query: { ...route.query, ...patch } })
}
function setFilter(key: 'direction' | 'state', value: string) {
  if (!hydrated.value) return
  writeQuery({ [key]: value === ALL ? undefined : value, offset: undefined })
}
function clearFilters() {
  if (!hydrated.value) return
  writeQuery({ direction: undefined, state: undefined, offset: undefined })
}
function setPage(next: number) {
  if (!hydrated.value || calls.isFetching.value || next < 1 || next > pages.value) return
  writeQuery({ offset: next > 1 ? String((next - 1) * PAGE_SIZE) : undefined })
}

// A kept link can point past the last page once calls are gone: it lands on the last page that still has rows.
watch([total, offset, () => calls.data.value, () => calls.isFetching.value], () => {
  if (!calls.data.value || calls.isFetching.value) return
  if (total.value === 0 || offset.value === 0 || items.value.length > 0) return
  const last = lastPageOffset(total.value, PAGE_SIZE)
  writeQuery({ offset: last > 0 ? String(last) : undefined })
})

const callTo = (id: number) => ({ path: `/calls/${id}`, query: returnToQuery(route.fullPath) })

const columns = computed<TableColumn<TelephonyCall>[]>(() => [
  { accessorKey: 'startedAt', header: t('telephony.column.started'), meta: { class: { th: 'w-48', td: 'w-48 whitespace-nowrap' } } },
  { accessorKey: 'direction', header: t('telephony.column.direction'), meta: { class: { th: 'w-28', td: 'w-28 whitespace-nowrap' } } },
  { accessorKey: 'remoteNumber', header: t('telephony.column.number'), meta: { title: true, class: { th: 'min-w-48', td: 'max-w-0' } } },
  { accessorKey: 'user', header: t('telephony.column.user') },
  { accessorKey: 'state', header: t('telephony.column.state'), meta: { class: { th: 'w-28', td: 'w-28 whitespace-nowrap' } } },
  { accessorKey: 'durationSeconds', header: t('telephony.column.duration'), meta: { class: { th: 'w-24', td: 'w-24' } } },
])
</script>

<template>
  <SharedListPage :title="t('telephony.title')" :description="t('telephony.calls.description')">
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <USelect
            :model-value="direction ?? ALL"
            :items="directionItems"
            icon="i-lucide-arrow-left-right"
            class="w-full md:w-48"
            :aria-label="t('telephony.column.direction')"
            :disabled="!hydrated"
            data-testid="calls-direction"
            @update:model-value="value => setFilter('direction', String(value))"
          />
          <USelect
            :model-value="state ?? ALL"
            :items="stateItems"
            icon="i-lucide-activity"
            class="w-full md:w-44"
            :aria-label="t('telephony.column.state')"
            :disabled="!hydrated"
            data-testid="calls-state"
            @update:model-value="value => setFilter('state', String(value))"
          />
        </SharedFilterBar>
      </template>

      <SharedDataTable
        bare
        :rows="items"
        :columns="columns"
        row-key="id"
        :row-to="row => callTo(row.id)"
        :loading="calls.isLoading.value"
        :error="calls.error.value"
        :empty-text="t(activeFilterCount ? 'app.noResults' : 'telephony.calls.empty')"
        :caption="t('telephony.title')"
        data-testid="calls-table"
        @retry="calls.refetch()"
      >
        <template #startedAt-cell="{ row }">
          <span class="tabular-nums">{{ callTime(row.original.startedAt, timeZone) || '—' }}</span>
        </template>
        <template #direction-cell="{ row }">
          {{ t(`telephony.direction.${row.original.direction}`) }}
        </template>
        <template #remoteNumber-cell="{ row }">
          <NuxtLink :to="callTo(row.original.id)" class="block min-w-0 rounded-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <template v-if="row.original.partner">
              <bdi class="block truncate font-medium text-highlighted">{{ row.original.partner.name }}</bdi>
              <bdi dir="ltr" class="block truncate text-muted tabular-nums">{{ callNumber(row.original) }}</bdi>
            </template>
            <bdi v-else dir="ltr" class="block truncate font-medium tabular-nums">{{ callNumber(row.original) || '—' }}</bdi>
          </NuxtLink>
        </template>
        <template #user-cell="{ row }">
          <bdi v-if="row.original.user">{{ row.original.user.name }}</bdi>
          <span v-else class="text-muted">—</span>
        </template>
        <template #state-cell="{ row }">
          {{ t(`telephony.state.${row.original.state}`) }}
        </template>
        <template #durationSeconds-cell="{ row }">
          <span dir="ltr" class="tabular-nums">{{ callDuration(row.original.durationSeconds) || '—' }}</span>
        </template>
      </SharedDataTable>

      <template v-if="!calls.error.value && items.length" #footer>
        <SharedListFooter
          :count-label="t('telephony.calls.count', { shown: items.length, total }, total)"
          count-test-id="calls-count"
          :page="page"
          :pages="pages"
          :disabled="!hydrated || calls.isFetching.value"
          @update:page="setPage"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
</template>
