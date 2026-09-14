<script setup lang="ts">
import FilterBar from '@/components/shared/FilterBar.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { ApiError } from '@/composables/useApi'
import {
  CHARTER_CATALOG_PAGE_SIZE,
  isCharterCatalogResource,
  useCharterCatalogList,
  useDeleteCharterReference,
  useUpdateCharterReference,
  type ProjectCharterReference,
} from '@/composables/useProjectCharterCatalogs'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const toast = useToast()
const hydrated = useHydrated()
const forbidden = computed(() => !can('pmo.settings.manage'))
const resource = computed(() => (isCharterCatalogResource(route.params.resource) ? route.params.resource : null))
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/settings/projects', ['/settings/projects', '/projects']))
const q = computed(() => typeof route.query.q === 'string' ? route.query.q : '')
const showInactive = computed(() => route.query.active === 'all' || route.query.active === '0')
const offset = computed(() => {
  const raw = Number(route.query.offset)
  return Number.isInteger(raw) && raw > 0 ? raw : 0
})
const params = computed(() => ({
  q: q.value || undefined,
  active: (showInactive.value ? 'all' : '1') as '1' | 'all',
  offset: offset.value,
  limit: CHARTER_CATALOG_PAGE_SIZE,
}))
const query = useCharterCatalogList(
  computed(() => resource.value ?? 'types'),
  params,
  computed(() => !forbidden.value && !!resource.value),
)
const { mutateAsync: patchReference, isPending: patching } = useUpdateCharterReference(computed(() => resource.value ?? 'types'))
const { mutateAsync: deleteReference, isPending: deleting } = useDeleteCharterReference(computed(() => resource.value ?? 'types'))
const pendingItem = ref<ProjectCharterReference | null>(null)
const pendingAction = ref<'disable' | 'enable' | 'delete' | null>(null)
const actionError = ref<string | null>(null)

const title = computed(() => resource.value === 'owning-units'
  ? t('settings.projects.catalogs.owningUnits')
  : t('settings.projects.catalogs.types'))

const page = computed(() => Math.floor(offset.value / CHARTER_CATALOG_PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / CHARTER_CATALOG_PAGE_SIZE)))
const activeFilterCount = computed(() => Number(Boolean(q.value)))

function listQuery(next: Record<string, string | undefined> = {}) {
  const current = {
    ...(q.value ? { q: q.value } : {}),
    ...(showInactive.value ? { active: 'all' } : {}),
    ...(offset.value ? { offset: String(offset.value) } : {}),
    ...next,
  }
  return Object.fromEntries(Object.entries(current).filter(([, value]) => value))
}

function onSearch(event: Event) {
  const value = (event.target as HTMLInputElement).value
  void router.replace({ query: listQuery({ q: value || undefined, offset: undefined }) })
}

// Active-only vs all is a dataset scope at the toolbar end, not a popover filter.
function toggleInactive(value: unknown) {
  const next = value === 'all'
  if (next === showInactive.value) return
  void router.replace({ query: listQuery({ active: next ? 'all' : undefined, offset: undefined }) })
}

function clearSearch() {
  void router.replace({ query: listQuery({ q: undefined, offset: undefined }) })
}

function clearFilters() {
  clearSearch()
}

function openNew() {
  if (!resource.value) return
  void navigateTo({ path: `/settings/projects/catalogs/${resource.value}/new`, query: returnToQuery(route.fullPath) })
}

function openEdit(id: number) {
  if (!resource.value) return
  void navigateTo({ path: `/settings/projects/catalogs/${resource.value}/${id}/edit`, query: returnToQuery(route.fullPath) })
}

function requestAction(item: ProjectCharterReference, action: 'disable' | 'enable' | 'delete') {
  pendingItem.value = item
  pendingAction.value = action
  actionError.value = null
}

async function confirmAction() {
  if (!pendingItem.value || !pendingAction.value || !hydrated.value) return
  actionError.value = null
  try {
    if (pendingAction.value === 'delete') await deleteReference(pendingItem.value.id)
    else await patchReference({ id: pendingItem.value.id, patch: { active: pendingAction.value === 'enable' } })
    toast.add({ title: t(`settings.projects.catalogs.${pendingAction.value}d`), color: 'success', icon: 'i-lucide-circle-check' })
    pendingItem.value = null
    pendingAction.value = null
  }
  catch (error) {
    actionError.value = error instanceof ApiError && error.code === 'conflict'
      ? t('settings.projects.catalogs.errors.inUse')
      : error instanceof ApiError ? error.message : t('errors.generic')
  }
}
</script>

<template>
  <SettingsLayout>
    <SharedPageHeader :title="title" :description="t('projects.refresh.settings.catalogDescription')" :back-to="returnTo" :back-label="t('settings.projects.catalogs.back')">
      <UButton v-if="resource && !forbidden" :disabled="!hydrated" @click="openNew">{{ t('settings.projects.catalogs.add') }}</UButton>
    </SharedPageHeader>
    <p v-if="!resource" class="text-muted">{{ t('settings.projects.catalogs.notFound') }}</p>
    <p v-else-if="forbidden" class="text-muted">{{ t('settings.forbidden') }}</p>
    <template v-else>
      <div class="w-full min-w-0" data-testid="catalog-toolbar">
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput :model-value="q" :placeholder="t('app.search')" :aria-label="t('app.search')" icon="i-lucide-search" class="min-w-52 flex-1" :disabled="!hydrated" @change="onSearch" />
          </template>
          <template #view>
            <UTabs
              data-testid="catalog-scope"
              :model-value="showInactive ? 'all' : 'active'"
              :items="[{ label: t('settings.projects.catalogs.scopeActive'), value: 'active', disabled: !hydrated }, { label: t('settings.projects.catalogs.scopeAll'), value: 'all', disabled: !hydrated }]"
              :aria-label="t('settings.projects.catalogs.showInactive')"
              size="sm"
              @update:model-value="toggleInactive"
            />
          </template>
          <template #active>
            <div v-if="activeFilterCount" class="flex flex-wrap items-center gap-2">
              <SharedFilterChip v-if="q" :label="q" @remove="clearSearch" />
            </div>
          </template>
        </FilterBar>
      </div>
      <SharedPageState
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty="!query.data.value?.items.length"
        :empty-text="t('settings.projects.catalogs.empty')"
        @retry="query.refetch"
      >
        <div class="nasq-ui-record-surface overflow-hidden">
          <ul>
            <li v-for="item in query.data.value?.items ?? []" :key="item.id" class="flex flex-wrap items-center justify-between gap-3 border-b border-default/80 p-3 last:border-0">
              <div>
                <p class="font-medium">{{ item.name }}</p>
                <p class="text-sm text-muted">{{ t('settings.projects.catalogs.sequenceValue', { sequence: item.sequence }) }} · {{ item.active ? t('settings.projects.catalogs.active') : t('settings.projects.catalogs.inactive') }}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <UButton type="button" variant="outline" size="sm" :disabled="!hydrated" @click="openEdit(item.id)">{{ t('settings.projects.catalogs.edit') }}</UButton>
                <UButton v-if="item.active" type="button" variant="outline" size="sm" :disabled="!hydrated || patching" @click="requestAction(item, 'disable')">{{ t('settings.projects.catalogs.disable') }}</UButton>
                <UButton v-else type="button" variant="outline" size="sm" :disabled="!hydrated || patching" @click="requestAction(item, 'enable')">{{ t('settings.projects.catalogs.enable') }}</UButton>
                <UButton type="button" color="error" size="sm" :disabled="!hydrated || deleting" @click="requestAction(item, 'delete')">{{ t('settings.projects.catalogs.delete') }}</UButton>
              </div>
            </li>
          </ul>
        </div>
      </SharedPageState>
      <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted">
        <UButton color="neutral" variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" :label="t('settings.projects.catalogs.previousPage')" @click="router.replace({ query: listQuery({ offset: page === 2 ? undefined : String((page - 2) * CHARTER_CATALOG_PAGE_SIZE) }) })" />
        <span>{{ t('settings.projects.catalogs.pageOf', { page, pages }) }}</span>
        <UButton color="neutral" variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" :label="t('settings.projects.catalogs.nextPage')" @click="router.replace({ query: listQuery({ offset: String(page * CHARTER_CATALOG_PAGE_SIZE) }) })" />
      </div>
      <div v-if="pendingItem && pendingAction" class="rounded-lg border border-error/30 bg-error/5 space-y-2 p-3 text-sm">
        <p>{{ t(`settings.projects.catalogs.confirm.${pendingAction}`, { name: pendingItem.name }) }}</p>
        <p v-if="actionError" role="alert" class="text-error">{{ actionError }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton color="neutral" variant="outline" type="button" :disabled="patching || deleting" @click="pendingItem = null; pendingAction = null">{{ t('app.cancel') }}</UButton>
          <UButton type="button" color="error" :disabled="!hydrated || patching || deleting" @click="confirmAction">{{ t(`settings.projects.catalogs.${pendingAction}`) }}</UButton>
        </div>
      </div>
    </template>
  </SettingsLayout>
</template>
