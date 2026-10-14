<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { useOperationRequests, type OperationScope } from '@/composables/operations/useOperations'
import { operationListLocation, safeOperationReturnTo, operationStateChoices, operationStateFromSelection } from '@/composables/operations/forms'
import { operationsStateTone } from '@/composables/operations/state'
const props = defineProps<{ scope: OperationScope; background?: boolean }>()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const path = computed(() => props.scope === 'mine' ? '/operations' : `/operations/${props.scope}`)
const allowed = computed(() => can(props.scope === 'pending' ? 'operations.requests.review' : props.scope === 'monitoring' ? 'operations.monitoring.read' : 'operations.requests.read'))
const filterQuery = computed(() => props.background && typeof route.query.returnTo === 'string' ? Object.fromEntries(new URLSearchParams(safeOperationReturnTo(route.query.returnTo, path.value).split('?')[1]?.split('#')[0] ?? '')) : route.query)
const page = computed(() => Math.max(1, Number.isSafeInteger(Number(filterQuery.value.page)) ? Number(filterQuery.value.page) : 1))
const selectedState = computed(() => operationStateFromSelection(filterQuery.value.state))
const q = ref(typeof filterQuery.value.q === 'string' ? filterQuery.value.q : '')
watch(() => filterQuery.value.q, value => { q.value = typeof value === 'string' ? value : '' })
const params = computed(() => ({ scope: props.scope, q: typeof filterQuery.value.q === 'string' ? filterQuery.value.q : undefined, state: selectedState.value || undefined, limit: 20, offset: (page.value - 1) * 20 }))
const query = useOperationRequests(params, allowed)
const items = computed(() => query.data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / 20)))
const backTo = computed(() => operationListLocation(path.value, route.query, route.hash))
async function update(values: Record<string, string | undefined>) {
  if (!hydrated.value) return
  await router.replace({ path: route.path, query: { ...route.query, ...values }, hash: route.hash })
}
const search = refDebounced(q, 300)
watch(search, value => { if (value.trim() !== String(filterQuery.value.q ?? '').trim()) void update({ q: value.trim() || undefined, page: undefined }) })
const stateItems = computed(() => operationStateChoices(t))
</script>
<template>
  <div class="min-w-0 space-y-5">
    <SharedPageHeader v-if="!background" :title="t(`operations.nav.${scope}`)">
      <template #actions><UButton v-if="can('operations.requests.create')" :to="{ path: '/operations/new', query: { returnTo: backTo } }" :disabled="!hydrated" icon="i-lucide-plus" :label="t('operations.newRequest')" /></template>
    </SharedPageHeader>
    <UAlert v-if="!allowed" color="error" :title="t('operations.errors.forbidden')" />
    <template v-else>
      <SharedFilterBar :active-count="Number(!!filterQuery.q) + Number(!!selectedState)" :default-open="!!selectedState" :disabled="!hydrated" @clear="update({ q: undefined, state: undefined, page: undefined })">
        <template #search><form @submit.prevent="update({ q: q.trim() || undefined, page: undefined })"><UInput v-model="q" class="w-full" icon="i-lucide-search" :placeholder="t('operations.searchRequests')" :aria-label="t('operations.searchRequests')" :disabled="!hydrated" /></form></template>
        <SharedFilterField :label="t('operations.state')" for="operation-state-filter"><USelect id="operation-state-filter" :model-value="selectedState ?? 'all'" :items="stateItems" :aria-label="t('operations.state')" :disabled="!hydrated" @update:model-value="value => update({ state: operationStateFromSelection(value), page: undefined })" /></SharedFilterField>
      </SharedFilterBar>
      <SharedPageState :loading="query.isPending.value" :error="query.error.value" :empty="!items.length" :empty-text="t('operations.emptyRequests')" @retry="hydrated && query.refetch()">
        <ul class="divide-y divide-default rounded-lg bg-default ring ring-default">
          <li v-for="item in items" :key="item.id" class="flex min-w-0 flex-wrap items-start justify-between gap-3 p-4">
            <div class="min-w-0 flex-1"><div class="flex min-w-0 items-baseline gap-2"><span class="sr-only">{{ t('operations.recordNumber') }}</span><SharedRecordNumber :value="item.id" /><UButton color="neutral" variant="link" class="max-w-full p-0 text-start" :label="item.name" :disabled="!hydrated" :to="{ path: `/operations/${item.id}`, query: { returnTo: backTo } }" /></div><p class="mt-1 text-sm text-muted">{{ item.process.name }} · {{ item.requester.name }}</p></div>
            <SharedStatusBadge :tone="operationsStateTone(item.state)" :label="t(`operations.states.${item.state}`)" />
          </li>
        </ul>
      </SharedPageState>
      <SharedPagination :page="page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: String(value) })" />
    </template>
  </div>
</template>
