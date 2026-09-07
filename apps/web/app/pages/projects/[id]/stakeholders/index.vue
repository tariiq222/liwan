<script setup lang="ts">
import { Plus, Search } from '@lucide/vue'
import FilterBar from '@/components/shared/FilterBar.vue'
import { useProjectStakeholders, useDeleteProjectStakeholder } from '@/composables/useProjectGovernance'
import { governanceFilters } from '@/components/project/governance/state'
import { ApiError } from '@/composables/useApi'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const parsed = computed(() => governanceFilters(route.query))
const filters = computed(() => ({ q: parsed.value.q, limit: 50, offset: parsed.value.offset }))
const list = useProjectStakeholders(id, filters)
const remove = useDeleteProjectStakeholder()
const confirmDeleteId = ref<number | null>(null)
const error = ref<string | null>(null)
const returnTo = computed(() => route.fullPath)
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, `/projects/${id.value}`, ['/projects']))
const viewQuery = computed(() => {
  const query: Record<string, string> = {}
  if (typeof route.query.returnTo === 'string') query.returnTo = route.query.returnTo
  if (typeof route.query.taskContext === 'string') query.taskContext = route.query.taskContext
  return query
})
function setFilter(key: string, value: string) {
  router.replace({ query: { ...route.query, [key]: value || undefined, offset: undefined } })
}
const q = computed({
  get: () => typeof route.query.q === 'string' ? route.query.q : '',
  set: value => setFilter('q', value),
})
function page(delta: number) {
  router.push({ query: { ...route.query, offset: String(Math.max(0, (parsed.value.offset ?? 0) + delta * 50)) } })
}
async function deleteItem(item: { id: number }) {
  error.value = null
  if (confirmDeleteId.value !== item.id) { confirmDeleteId.value = item.id; return }
  try {
    await remove.mutateAsync({ projectId: id.value, id: item.id })
    confirmDeleteId.value = null
  }
  catch (cause) {
    error.value = cause instanceof ApiError && cause.code === 'stakeholder_assigned'
      ? t('projects.governance.stakeholderAssigned')
      : cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader
      :title="t('projects.governance.stakeholders')"
      :back-to="projectReturnTo"
      :back-label="t('projects.backToProject')"
    >
      <template #actions>
        <NuxtLink
          v-if="list.data.value?.can_manage && hydrated"
          :to="{ path: `/projects/${id}/stakeholders/new`, query: { returnTo } }"
        >
          <Button class="gap-2" data-testid="stakeholders-create">
            <Plus class="size-[18px]" />{{ t('projects.governance.newStakeholder') }}
          </Button>
        </NuxtLink>
      </template>
    </SharedPageHeader>
    <nav class="nasq-tabs" :aria-label="t('nav.projectStakeholders')">
      <NuxtLink :to="{ path: `/projects/${id}/stakeholders`, query: viewQuery }" aria-current="page">{{ t('projects.governance.viewList') }}</NuxtLink>
      <NuxtLink :to="{ path: `/projects/${id}/raci`, query: viewQuery }">{{ t('projects.governance.viewMatrix') }}</NuxtLink>
    </nav>
    <div class="nasq-toolbar" data-testid="stakeholders-toolbar">
      <FilterBar class="w-full">
        <template #search>
          <div class="relative min-w-52">
            <Search class="pointer-events-none absolute start-2 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input
              v-model="q"
              :aria-label="t('app.search')"
              :disabled="!hydrated"
              :placeholder="t('app.search')"
              class="h-[40px] ps-8"
            />
          </div>
        </template>
      </FilterBar>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <SharedPageState
      :loading="list.isLoading.value"
      :error="list.error.value"
      :empty="!list.isLoading.value && !list.data.value?.items.length"
      @retry="list.refetch"
    />
    <section v-if="list.data?.value?.items.length" class="nasq-panel overflow-hidden">
      <div class="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="text-start">{{ t('projects.governance.stakeholder.name') }}</TableHead>
              <TableHead class="text-start">{{ t('projects.governance.stakeholder.organization') }}</TableHead>
              <TableHead class="text-start">{{ t('projects.governance.stakeholder.role') }}</TableHead>
              <TableHead class="text-start" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="item in list.data.value.items" :key="item.id">
              <TableCell>
                <NuxtLink
                  class="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :to="{ path: `/projects/${id}/stakeholders/${item.id}`, query: { returnTo } }"
                >
                  {{ item.name }}
                </NuxtLink>
              </TableCell>
              <TableCell>{{ item.organization || '—' }}</TableCell>
              <TableCell>{{ item.role || '—' }}</TableCell>
              <TableCell v-if="list.data.value.can_manage" class="text-end">
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="!hydrated || remove.isPending.value"
                  @click="deleteItem(item)"
                >
                  {{ confirmDeleteId === item.id ? t('projects.governance.confirmDeleteAction') : t('projects.governance.delete') }}
                </Button>
                <Button
                  v-if="confirmDeleteId === item.id"
                  variant="outline"
                  size="sm"
                  :disabled="!hydrated || remove.isPending.value"
                  @click="confirmDeleteId = null"
                >
                  {{ t('app.cancel') }}
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>
    <nav
      v-if="list.data.value"
      class="flex items-center justify-between text-sm text-muted-foreground"
      :aria-label="t('projects.governance.pagination')"
    >
      <Button variant="ghost" :disabled="!hydrated || list.isFetching.value || !parsed.offset" @click="page(-1)">
        {{ t('projects.governance.previous') }}
      </Button>
      <span>{{ t('projects.governance.total', { total: list.data.value.total }) }}</span>
      <Button
        variant="ghost"
        :disabled="!hydrated || list.isFetching.value || (parsed.offset ?? 0) + 50 >= list.data.value.total"
        @click="page(1)"
      >
        {{ t('projects.governance.next') }}
      </Button>
    </nav>
  </SharedPageContainer>
</template>
