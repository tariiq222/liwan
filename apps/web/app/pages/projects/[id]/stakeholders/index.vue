<script setup lang="ts">
import { inject } from 'vue'
import FilterBar from '@/components/shared/FilterBar.vue'
import { useProjectStakeholders, useDeleteProjectStakeholder } from '@/composables/useProjectGovernance'
import { governanceFilters } from '@/components/project/governance/state'
import { ApiError } from '@/composables/useApi'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const isProjectOverlay = inject<boolean>(Symbol.for('nasq.project.overlay'), false)
const id = computed(() => Number(route.params.id))
const { data: project } = useProject(computed(() => Number.isInteger(id.value) && id.value > 0 ? id.value : null))
const parsed = computed(() => governanceFilters(route.query))
const filters = computed(() => ({ q: parsed.value.q, limit: 50, offset: parsed.value.offset }))
const list = useProjectStakeholders(id, filters)
const remove = useDeleteProjectStakeholder()
const confirmDeleteId = ref<number | null>(null)
const error = ref<string | null>(null)
const returnTo = computed(() => route.fullPath)
const viewQuery = computed(() => {
  const query: Record<string, string> = {}
  if (typeof route.query.returnTo === 'string') query.returnTo = route.query.returnTo
  if (typeof route.query.taskContext === 'string') query.taskContext = route.query.taskContext
  if (typeof route.query.projectListReturnTo === 'string') query.projectListReturnTo = route.query.projectListReturnTo
  return query
})
function setFilter(key: string, value: string) {
  router.replace({ query: { ...route.query, [key]: value || undefined, offset: undefined } })
}
const q = computed({
  get: () => typeof route.query.q === 'string' ? route.query.q : '',
  set: value => setFilter('q', value),
})
const activeFilterCount = computed(() => Number(Boolean(q.value.trim())))
function clearFilters() {
  router.replace({ query: { ...route.query, q: undefined, offset: undefined } })
}
function page(delta: number) {
  router.push({ query: { ...route.query, offset: String(Math.max(0, (parsed.value.offset ?? 0) + delta * 50)) } })
}
const columns = computed(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('projects.governance.stakeholder.name') },
  { accessorKey: 'organization', header: t('projects.governance.stakeholder.organization') },
  { accessorKey: 'role', header: t('projects.governance.stakeholder.role') },
  { id: 'actions', header: t('app.actions') },
])
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
      v-if="!isProjectOverlay"
      :title="t('nav.projectStakeholders')"
    >
      <template #actions>
        <UButton
          v-if="list.data.value?.can_manage && hydrated"
          data-testid="stakeholders-create"
          icon="i-lucide-plus"
          :to="{ path: `/projects/${id}/stakeholders/new`, query: { returnTo } }"
        >
          {{ t('projects.governance.newStakeholder') }}
        </UButton>
      </template>
    </SharedPageHeader>
    <FilterBar class="w-full" data-testid="stakeholders-toolbar" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
      <template #view>
        <nav class="flex flex-wrap items-center gap-1" :aria-label="t('projects.governance.views')">
          <UButton color="neutral" variant="soft" :to="{ path: `/projects/${id}/stakeholders`, query: viewQuery }" aria-current="page">{{ t('projects.governance.viewList') }}</UButton>
          <UButton color="neutral" variant="ghost" :to="{ path: `/projects/${id}/raci`, query: viewQuery }">{{ t('projects.governance.viewMatrix') }}</UButton>
        </nav>
      </template>
      <template #search>
        <UInput
          v-model="q"
          :aria-label="t('projects.clarity.stakeholderSearch')"
          :disabled="!hydrated"
          :placeholder="t('projects.clarity.stakeholderSearch')"
          icon="i-lucide-search"
          class="min-w-52"
        />
      </template>
      <template #active>
        <div v-if="q.trim()" class="flex flex-wrap items-center gap-2">
          <UBadge color="secondary" variant="subtle">{{ t('projects.clarity.stakeholderSearch') }}: {{ q }}</UBadge>
        </div>
      </template>
    </FilterBar>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <SharedPageState
      :loading="list.isLoading.value"
      :error="list.error.value"
      :empty="!list.isLoading.value && !list.data.value?.items.length"
      :empty-text="t(activeFilterCount ? 'projects.clarity.filteredEmpty' : 'projects.clarity.stakeholdersEmpty')"
      @retry="list.refetch"
    />
    <section v-if="list.data?.value?.items.length" class="rounded-xl border border-default bg-default overflow-hidden" :aria-label="t('projects.governance.stakeholders')">
      <div class="hidden min-w-0 overflow-x-auto md:block">
        <UTable :data="list.data.value.items" :columns="columns">
          <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
          <template #name-cell="{ row }">
            <NuxtLink
              class="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              :to="{ path: `/projects/${id}/stakeholders/${row.original.id}`, query: { returnTo } }"
            >
              {{ row.original.name }}
            </NuxtLink>
          </template>
          <template #organization-cell="{ row }">{{ row.original.organization || '—' }}</template>
          <template #role-cell="{ row }">{{ row.original.role || '—' }}</template>
          <template #actions-cell="{ row }">
            <div class="flex justify-end gap-2">
              <template v-if="list.data.value?.can_manage">
                <UButton
                  variant="ghost"
                  size="sm"
                  :disabled="!hydrated || remove.isPending.value"
                  @click="deleteItem(row.original)"
                >
                  {{ confirmDeleteId === row.original.id ? t('projects.governance.confirmDeleteAction') : t('projects.governance.delete') }}
                </UButton>
                <UButton color="secondary" variant="solid"
                  v-if="confirmDeleteId === row.original.id"
                  size="sm"
                  :disabled="!hydrated || remove.isPending.value"
                  @click="confirmDeleteId = null"
                >
                  {{ t('app.cancel') }}
                </UButton>
              </template>
            </div>
          </template>
        </UTable>
      </div>
      <ul class="grid gap-3 p-3 md:hidden" :aria-label="t('projects.governance.stakeholders')">
        <li v-for="item in list.data.value.items" :key="`mobile-stakeholder-${item.id}`">
          <UCard>
            <div class="space-y-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <RecordNumber :value="item.id" />
                  <NuxtLink
                    class="block font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    :to="{ path: `/projects/${id}/stakeholders/${item.id}`, query: { returnTo } }"
                  >
                    {{ item.name }}
                  </NuxtLink>
                </div>
              </div>
              <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt class="text-xs text-muted">{{ t('projects.governance.stakeholder.organization') }}</dt>
                  <dd>{{ item.organization || '—' }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted">{{ t('projects.governance.stakeholder.role') }}</dt>
                  <dd>{{ item.role || '—' }}</dd>
                </div>
              </dl>
              <div v-if="list.data.value?.can_manage" class="flex justify-end gap-2">
                <UButton
                  variant="ghost"
                  size="sm"
                  :disabled="!hydrated || remove.isPending.value"
                  @click="deleteItem(item)"
                >
                  {{ confirmDeleteId === item.id ? t('projects.governance.confirmDeleteAction') : t('projects.governance.delete') }}
                </UButton>
                <UButton color="secondary" variant="solid"
                  v-if="confirmDeleteId === item.id"
                  size="sm"
                  :disabled="!hydrated || remove.isPending.value"
                  @click="confirmDeleteId = null"
                >
                  {{ t('app.cancel') }}
                </UButton>
              </div>
            </div>
          </UCard>
        </li>
      </ul>
    </section>
    <nav
      v-if="list.data.value && (list.data.value.total > 50 || parsed.offset)"
      class="flex items-center justify-between text-sm text-muted"
      :aria-label="t('projects.governance.pagination')"
    >
      <UButton color="secondary" variant="solid" :disabled="!hydrated || list.isFetching.value || !parsed.offset" @click="page(-1)">
        {{ t('projects.governance.previous') }}
      </UButton>
      <span>{{ t('projects.governance.total', { total: list.data.value.total }) }}</span>
      <UButton color="secondary" variant="solid"
        :disabled="!hydrated || list.isFetching.value || (parsed.offset ?? 0) + 50 >= list.data.value.total"
        @click="page(1)"
      >
        {{ t('projects.governance.next') }}
      </UButton>
    </nav>
  </SharedPageContainer>
</template>
