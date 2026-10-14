<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { useOperationProcesses } from '@/composables/operations/useOperations'
import { operationListLocation, safeOperationReturnTo } from '@/composables/operations/forms'
import StateBadge from './StateBadge.vue'
const props = defineProps<{ background?: boolean }>()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const allowed = computed(() => can('operations.processes.manage'))
const filterQuery = computed(() => props.background && typeof route.query.returnTo === 'string' ? Object.fromEntries(new URLSearchParams(safeOperationReturnTo(route.query.returnTo, '/operations/processes').split('?')[1]?.split('#')[0] ?? '')) : route.query)
const page = computed(() => Math.max(1, Number.isSafeInteger(Number(filterQuery.value.page)) ? Number(filterQuery.value.page) : 1))
const q = ref(typeof filterQuery.value.q === 'string' ? filterQuery.value.q : '')
watch(() => filterQuery.value.q, value => { q.value = typeof value === 'string' ? value : '' })
const params = computed(() => ({ q: typeof filterQuery.value.q === 'string' ? filterQuery.value.q : undefined, limit: 20, offset: (page.value - 1) * 20 }))
const query = useOperationProcesses(params, allowed)
const items = computed(() => query.data.value?.items ?? [])
const backTo = computed(() => operationListLocation('/operations/processes', route.query, route.hash))
async function update(values: Record<string, string | undefined>) { if (hydrated.value) await router.replace({ path: route.path, query: { ...route.query, ...values }, hash: route.hash }) }const search = refDebounced(q, 300)
watch(search, value => { if (value.trim() !== String(filterQuery.value.q ?? '').trim()) void update({ q: value.trim() || undefined, page: undefined }) })

</script>
<template>
  <div class="min-w-0 space-y-5">
    <SharedPageHeader v-if="!props.background" :title="t('operations.nav.processes')"><template #actions><UButton v-if="allowed" :disabled="!hydrated" :to="{ path: '/operations/processes/new', query: { returnTo: backTo } }" icon="i-lucide-plus" :label="t('operations.newProcess')" /></template></SharedPageHeader>
    <UAlert v-if="!allowed" color="error" :title="t('operations.errors.forbidden')" />
    <template v-else>
      <SharedFilterBar :active-count="Number(!!route.query.q)" :disabled="!hydrated" @clear="update({ q: undefined, page: undefined })"><template #search><form @submit.prevent="update({ q: q.trim() || undefined, page: undefined })"><UInput v-model="q" class="w-full" :placeholder="t('operations.searchProcesses')" :aria-label="t('operations.searchProcesses')" :disabled="!hydrated" /></form></template></SharedFilterBar>
      <SharedPageState :loading="query.isPending.value" :error="query.error.value" :empty="!items.length" :empty-text="t('operations.emptyProcesses')" @retry="hydrated && query.refetch()">
        <ul class="divide-y divide-default rounded-lg bg-default ring ring-default"><li v-for="process in items" :key="process.id" class="flex flex-wrap items-start justify-between gap-3 p-4"><div class="min-w-0 flex-1"><div class="flex min-w-0 items-baseline gap-2"><span class="sr-only">{{ t('operations.recordNumber') }}</span><SharedRecordNumber :value="process.id" /><UButton color="neutral" variant="link" class="p-0 text-start" :label="process.name" :disabled="!hydrated" :to="{ path: `/operations/processes/${process.id}`, query: { returnTo: backTo } }" /></div><p class="mt-1 text-sm text-muted">{{ t('operations.stageCount', { count: process.steps.length }) }}</p></div><StateBadge :state="process.state" /></li></ul>
      </SharedPageState>
      <SharedPagination :page="page" :pages="Math.max(1, Math.ceil((query.data.value?.total ?? 0) / 20))" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: String(value) })" />
    </template>
  </div>
</template>
