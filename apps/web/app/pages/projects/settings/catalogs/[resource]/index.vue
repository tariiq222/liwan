<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import FilterBar from '@/components/shared/data/FilterBar.vue'
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
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects/settings', ['/projects/settings', '/projects']))
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

const columns = computed<TableColumn<ProjectCharterReference>[]>(() => [
  { id: 'name', header: t('settings.projects.catalogs.name') },
  { id: 'sequence', header: t('settings.projects.catalogs.sequence') },
  ...(resource.value === 'types' ? [{ id: 'steps', header: t('settings.projects.catalogs.charterSteps') }] : []),
  { id: 'status', header: t('projects.milestones.state') },
  { id: 'actions', header: t('app.actions'), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } },
])

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

function isCatalogList() {
  return /^\/projects\/settings\/catalogs\/[^/]+$/.test(route.path.replace(/\/+$/, '') || '/')
}
function onSearch(event: Event) {
  if (!isCatalogList()) return
  const value = (event.target as HTMLInputElement).value
  void router.replace({ query: listQuery({ q: value || undefined, offset: undefined }) })
}

// Active-only vs all is a dataset scope at the toolbar end, not a popover filter.
function toggleInactive(value: unknown) {
  const next = value === 'all'
  if (next === showInactive.value) return
  if (!isCatalogList()) return
  void router.replace({ query: listQuery({ active: next ? 'all' : undefined, offset: undefined }) })
}

function clearSearch() {
  if (!isCatalogList()) return
  void router.replace({ query: listQuery({ q: undefined, offset: undefined }) })
}

function clearFilters() {
  clearSearch()
}

function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || next < 1 || next > pages.value) return
  if (!isCatalogList()) return
  void router.replace({ query: listQuery({ offset: next === 1 ? undefined : String((next - 1) * CHARTER_CATALOG_PAGE_SIZE) }) })
}

function openNew() {
  if (!resource.value) return
  void navigateTo({ path: `/projects/settings/catalogs/${resource.value}/new`, query: returnToQuery(route.fullPath) })
}

function openEdit(id: number) {
  if (!resource.value) return
  void navigateTo({ path: `/projects/settings/catalogs/${resource.value}/${id}/edit`, query: returnToQuery(route.fullPath) })
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
  <SharedSettingsPage>
    <SharedPageHeader :title="title" :description="t('projects.refresh.settings.catalogDescription')" :back-to="returnTo" :back-label="t('settings.projects.catalogs.back')">
      <UButton v-if="resource && !forbidden" icon="i-lucide-plus" data-shortcut-create aria-keyshortcuts="c" :disabled="!hydrated" :label="t('settings.projects.catalogs.add')" @click="openNew" />
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
      <SharedDataTable
        :rows="query.data.value?.items ?? []"
        :columns="columns"
        row-key="id"
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty-text="t('settings.projects.catalogs.empty')"
        :page="page"
        :pages="pages"
        :caption="title"
        @update:page="setPage"
        @retry="query.refetch"
      >
        <template #name-cell="{ row }"><span class="font-medium text-highlighted">{{ row.original.name }}</span></template>
        <template #sequence-cell="{ row }">{{ t('settings.projects.catalogs.sequenceValue', { sequence: row.original.sequence }) }}</template>
        <template #steps-cell="{ row }">{{ row.original.charter_steps ? t('settings.projects.catalogs.charterStepsColumn', { count: row.original.charter_steps.length }, row.original.charter_steps.length) : '—' }}</template>
        <template #status-cell="{ row }"><SharedStatusBadge :tone="row.original.active ? 'success' : 'neutral'" :label="row.original.active ? t('settings.projects.catalogs.active') : t('settings.projects.catalogs.inactive')" /></template>
        <template #actions-cell="{ row }">
          <div class="flex flex-wrap justify-end gap-2">
            <UButton type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated" @click="openEdit(row.original.id)">{{ t('settings.projects.catalogs.edit') }}</UButton>
            <UButton v-if="row.original.active" type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated || patching" @click="requestAction(row.original, 'disable')">{{ t('settings.projects.catalogs.disable') }}</UButton>
            <UButton v-else type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated || patching" @click="requestAction(row.original, 'enable')">{{ t('settings.projects.catalogs.enable') }}</UButton>
            <UButton type="button" color="error" size="sm" :disabled="!hydrated || deleting" @click="requestAction(row.original, 'delete')">{{ t('settings.projects.catalogs.delete') }}</UButton>
          </div>
        </template>
        <template #mobile-row="{ row: item }">
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-3">
              <p class="font-medium text-highlighted">{{ item.name }}</p>
              <SharedStatusBadge :tone="item.active ? 'success' : 'neutral'" :label="item.active ? t('settings.projects.catalogs.active') : t('settings.projects.catalogs.inactive')" />
            </div>
            <p class="text-sm text-muted">{{ t('settings.projects.catalogs.sequenceValue', { sequence: item.sequence }) }}<template v-if="item.charter_steps"> · {{ t('settings.projects.catalogs.charterStepsColumn', { count: item.charter_steps.length }, item.charter_steps.length) }}</template></p>
            <div class="flex flex-wrap gap-2">
              <UButton type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated" @click="openEdit(item.id)">{{ t('settings.projects.catalogs.edit') }}</UButton>
              <UButton v-if="item.active" type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated || patching" @click="requestAction(item, 'disable')">{{ t('settings.projects.catalogs.disable') }}</UButton>
              <UButton v-else type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated || patching" @click="requestAction(item, 'enable')">{{ t('settings.projects.catalogs.enable') }}</UButton>
              <UButton type="button" color="error" size="sm" :disabled="!hydrated || deleting" @click="requestAction(item, 'delete')">{{ t('settings.projects.catalogs.delete') }}</UButton>
            </div>
          </div>
        </template>
      </SharedDataTable>
      <SharedInlineConfirm
        v-if="pendingItem && pendingAction"
        :color="pendingAction === 'enable' ? 'primary' : 'error'"
        :title="t(`settings.projects.catalogs.confirm.${pendingAction}`, { name: pendingItem.name })"
        :confirm-label="t(`settings.projects.catalogs.${pendingAction}`)"
        :pending="patching || deleting"
        @cancel="pendingItem = null; pendingAction = null"
        @confirm="confirmAction"
      >
        <p v-if="actionError" role="alert" class="text-error">{{ actionError }}</p>
      </SharedInlineConfirm>
    </template>
  </SharedSettingsPage>
</template>
