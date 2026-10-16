<script setup lang="ts">
import { accessBadge } from '@/components/access/accessBadge'
import type { TableColumn } from '@nuxt/ui'
import type { RoleSummary } from '@webvue/contracts'
import type { RouteLocationRaw } from 'vue-router'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'
import { builtinRoleDescription } from '@/utils/labelFallback'

// The roles table on SharedDataTable. A row opens the role through `toFor`; clone is the page's call.
const props = defineProps<{
  roles: RoleSummary[]
  canManage?: boolean
  loading?: boolean
  error?: unknown
  emptyText?: string
  toFor?: (role: RoleSummary) => RouteLocationRaw
}>()
const emit = defineEmits<{ clone: [id: number]; retry: [] }>()
const { t, te, locale } = useI18n()
const roleLabel = (role: { name: { ar: string; en: string | null } }) => role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar
const roleDescription = (role: RoleSummary) => builtinRoleDescription(role, t, te)
const roleTo = (role: RoleSummary): RouteLocationRaw => props.toFor?.(role) ?? `/settings/roles/${role.id}`
const badge = (role: RoleSummary) => accessBadge({ active: role.active, protected: role.protected })
const typeLabel = (role: RoleSummary) => role.type === 'built_in' ? t('access.roles.builtIn') : t('access.roles.custom')

function actionsFor(role: RoleSummary): RowAction[] {
  return [
    { label: t('access.view'), icon: 'i-lucide-eye', to: roleTo(role) },
    ...(props.canManage ? [{ label: t('access.roles.clone'), icon: 'i-lucide-copy', onSelect: () => emit('clone', role.id) } satisfies RowAction] : []),
  ]
}

const columns = computed<TableColumn<RoleSummary>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('access.roles.columns.name') },
  { accessorKey: 'description', header: t('access.roles.columns.description') },
  { accessorKey: 'type', header: t('access.roles.columns.type') },
  { accessorKey: 'user_count', header: t('access.roles.columns.users') },
  { accessorKey: 'active', header: t('access.roles.columns.status') },
  { accessorKey: 'actions', header: t('access.roles.columns.actions') },
])
</script>

<template>
  <SharedDataTable
    :rows="roles" :columns="columns" row-key="id" :row-to="roleTo" :loading="loading" :error="error"
    :empty-text="emptyText" :caption="t('access.roles.title')" @retry="$emit('retry')"
  >
    <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
    <template #name-cell="{ row }">
      <NuxtLink :to="roleTo(row.original)" class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ roleLabel(row.original) }}</NuxtLink>
    </template>
    <template #description-cell="{ row }"><span class="max-w-xs whitespace-normal">{{ roleDescription(row.original) }}</span></template>
    <template #type-cell="{ row }">{{ typeLabel(row.original) }}</template>
    <template #user_count-cell="{ row }">{{ row.original.user_count }}</template>
    <template #active-cell="{ row }"><SharedStatusBadge :tone="badge(row.original).tone" :label="t(badge(row.original).labelKey)" :icon="badge(row.original).icon" /></template>
    <template #actions-cell="{ row }">
      <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t('access.roles.rowActions', { name: roleLabel(row.original) })" /></div>
    </template>
    <template #mobile-row="{ row }">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <bdi class="block text-xs text-muted">#{{ row.id }}</bdi>
          <NuxtLink :to="roleTo(row)" class="font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ roleLabel(row) }}</NuxtLink>
        </div>
        <SharedStatusBadge :tone="badge(row).tone" :label="t(badge(row).labelKey)" :icon="badge(row).icon" />
      </div>
      <p class="mt-2 text-xs text-muted">{{ roleDescription(row) }}</p>
      <dl class="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
        <div><dt>{{ t('access.roles.columns.type') }}</dt><dd>{{ typeLabel(row) }}</dd></div>
        <div><dt>{{ t('access.roles.columns.users') }}</dt><dd>{{ row.user_count }}</dd></div>
      </dl>
      <div class="mt-3 flex justify-end"><SharedRowActions :actions="actionsFor(row)" :label="t('access.roles.rowActions', { name: roleLabel(row) })" /></div>
    </template>
  </SharedDataTable>
</template>
