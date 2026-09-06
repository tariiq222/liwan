<script setup lang="ts">
import { toast } from 'vue-sonner'
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

function toggleInactive() {
  void router.replace({ query: listQuery({ active: showInactive.value ? undefined : 'all', offset: undefined }) })
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
    toast.success(t(`settings.projects.catalogs.${pendingAction.value}d`))
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
  <div class="space-y-6">
    <nav><NuxtLink :to="returnTo" class="text-sm text-muted-foreground hover:underline">{{ t('settings.projects.catalogs.back') }}</NuxtLink></nav>
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">{{ title }}</h1>
      <Button v-if="resource && !forbidden" :disabled="!hydrated" @click="openNew">{{ t('settings.projects.catalogs.add') }}</Button>
    </header>
    <p v-if="!resource" class="text-muted-foreground">{{ t('settings.projects.catalogs.notFound') }}</p>
    <p v-else-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
    <template v-else>
      <div class="flex flex-wrap gap-2">
        <Input :model-value="q" :placeholder="t('app.search')" class="max-w-sm" :disabled="!hydrated" @change="onSearch" />
        <Button variant="outline" :disabled="!hydrated" :aria-pressed="showInactive" @click="toggleInactive">
          {{ t('settings.projects.catalogs.showInactive') }}
        </Button>
      </div>
      <p v-if="query.isLoading.value" role="status" class="text-muted-foreground">{{ t('app.loading') }}</p>
      <p v-else-if="query.error.value" role="alert" class="text-destructive">{{ t('settings.projects.catalogs.loadError') }}</p>
      <p v-else-if="!query.data.value?.items.length" class="text-muted-foreground">{{ t('settings.projects.catalogs.empty') }}</p>
      <ul v-else class="divide-y rounded-md border">
        <li v-for="item in query.data.value.items" :key="item.id" class="flex flex-wrap items-center justify-between gap-3 p-3">
          <div>
            <p class="font-medium">{{ item.name }}</p>
            <p class="text-sm text-muted-foreground">{{ t('settings.projects.catalogs.sequenceValue', { sequence: item.sequence }) }} · {{ item.active ? t('settings.projects.catalogs.active') : t('settings.projects.catalogs.inactive') }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" :disabled="!hydrated" @click="openEdit(item.id)">{{ t('settings.projects.catalogs.edit') }}</Button>
            <Button v-if="item.active" type="button" variant="outline" size="sm" :disabled="!hydrated || patching" @click="requestAction(item, 'disable')">{{ t('settings.projects.catalogs.disable') }}</Button>
            <Button v-else type="button" variant="outline" size="sm" :disabled="!hydrated || patching" @click="requestAction(item, 'enable')">{{ t('settings.projects.catalogs.enable') }}</Button>
            <Button type="button" variant="destructive" size="sm" :disabled="!hydrated || deleting" @click="requestAction(item, 'delete')">{{ t('settings.projects.catalogs.delete') }}</Button>
          </div>
        </li>
      </ul>
      <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
        <Button variant="ghost" :disabled="!hydrated || page === 1" @click="router.replace({ query: listQuery({ offset: page === 2 ? undefined : String((page - 2) * CHARTER_CATALOG_PAGE_SIZE) }) })">{{ t('settings.projects.catalogs.previousPage') }}</Button>
        <span>{{ t('settings.projects.catalogs.pageOf', { page, pages }) }}</span>
        <Button variant="ghost" :disabled="!hydrated || page >= pages" @click="router.replace({ query: listQuery({ offset: String(page * CHARTER_CATALOG_PAGE_SIZE) }) })">{{ t('settings.projects.catalogs.nextPage') }}</Button>
      </div>
      <div v-if="pendingItem && pendingAction" class="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p>{{ t(`settings.projects.catalogs.confirm.${pendingAction}`, { name: pendingItem.name }) }}</p>
        <p v-if="actionError" role="alert" class="text-destructive">{{ actionError }}</p>
        <div class="flex flex-wrap gap-2">
          <Button type="button" variant="outline" :disabled="patching || deleting" @click="pendingItem = null; pendingAction = null">{{ t('app.cancel') }}</Button>
          <Button type="button" variant="destructive" :disabled="!hydrated || patching || deleting" @click="confirmAction">{{ t(`settings.projects.catalogs.${pendingAction}`) }}</Button>
        </div>
      </div>
    </template>
  </div>
</template>
