<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import type { TableColumn } from '@nuxt/ui'
import type { TelephonyCall } from '@liwan/contracts'
import { TelephonyCallListSchema } from '@liwan/contracts'

const { t } = useI18n()
const { $api } = useApi()
const route = useRoute()
const router = useRouter()

const direction = computed(() => (route.query.direction as string) || '')
const state = computed(() => (route.query.state as string) || '')
const offset = computed(() => Number(route.query.offset || 0))
const limit = 25

const calls = useQuery({
  queryKey: ['telephony', 'calls', direction, state, offset],
  queryFn: () => $api('/api/v1/telephony/calls', {
    schema: TelephonyCallListSchema,
    query: { direction: direction.value, state: state.value, limit, offset: offset.value },
  }),
})

const items = computed(() => calls.data.value?.items ?? [])
const total = computed(() => calls.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / limit) + 1)
const pages = computed(() => Math.max(Math.ceil(total.value / limit), 1))

function setPage(next: number) {
  router.replace({ query: { ...route.query, offset: next > 1 ? (next - 1) * limit : undefined } })
}

function setFilter(key: 'direction' | 'state', value: string) {
  router.replace({ query: { ...route.query, [key]: value || undefined, offset: undefined } })
}

const directionItems = computed(() => [
  { value: '', label: t('telephony.filter.all') },
  { value: 'in', label: t('telephony.direction.in') },
  { value: 'out', label: t('telephony.direction.out') },
  { value: 'internal', label: t('telephony.direction.internal') },
])
const stateItems = computed(() => [
  { value: '', label: t('telephony.filter.allStates') },
  { value: 'answered', label: t('telephony.state.answered') },
  { value: 'missed', label: t('telephony.state.missed') },
  { value: 'ended', label: t('telephony.state.ended') },
  { value: 'failed', label: t('telephony.state.failed') },
])

const columns = computed<TableColumn<TelephonyCall>[]>(() => [
  { accessorKey: 'startedAt', header: t('telephony.column.started') },
  { accessorKey: 'direction', header: t('telephony.column.direction') },
  { accessorKey: 'remoteNumber', header: t('telephony.column.number') },
  { accessorKey: 'state', header: t('telephony.column.state') },
  { accessorKey: 'durationSeconds', header: t('telephony.column.duration') },
])

function duration(seconds: number | null) {
  if (!seconds) return '—'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
</script>

<template>
  <SharedListPage
    :title="t('telephony.title')"
    :description="t('telephony.calls.description')"
  >
    <SharedListCard>
      <div class="flex flex-wrap gap-(--liwan-gap-card) border-b border-default px-4 py-3">
        <USelect
          :model-value="direction"
          :items="directionItems"
          class="w-40"
          :aria-label="t('telephony.column.direction')"
          @update:model-value="setFilter('direction', $event)"
        />
        <USelect
          :model-value="state"
          :items="stateItems"
          class="w-40"
          :aria-label="t('telephony.column.state')"
          @update:model-value="setFilter('state', $event)"
        />
      </div>
      <SharedPageState
        :loading="calls.isPending.value"
        :error="calls.error.value"
        :empty="items.length === 0"
        :empty-text="t('telephony.calls.empty')"
        @retry="calls.refetch()"
      >
        <SharedDataTable :rows="items" :columns="columns" row-key="id" bare>
          <template #startedAt-cell="{ row }">
            <span dir="ltr">{{ row.original.startedAt ? row.original.startedAt.replace('T', ' ').slice(0, 16) : '—' }}</span>
          </template>
          <template #direction-cell="{ row }">
            {{ t(`telephony.direction.${row.original.direction}`) }}
          </template>
          <template #remoteNumber-cell="{ row }">
            <NuxtLink
              v-if="row.original.id"
              :to="`/calls/${row.original.id}`"
              class="text-primary hover:underline"
              dir="ltr"
            >
              {{ row.original.remoteNumber || row.original.extension || '—' }}
            </NuxtLink>
          </template>
          <template #state-cell="{ row }">
            {{ t(`telephony.state.${row.original.state}`) }}
          </template>
          <template #durationSeconds-cell="{ row }">
            <span dir="ltr">{{ duration(row.original.durationSeconds) }}</span>
          </template>
        </SharedDataTable>
      </SharedPageState>
      <template #footer>
        <SharedListFooter
          :count-label="t('telephony.calls.count', { shown: items.length, total })"
          :page="page"
          :pages="pages"
          @update:page="setPage"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
</template>
