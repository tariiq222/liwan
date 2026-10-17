<script setup lang="ts">
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { accessBadge } from '@/components/access/accessBadge'
import type { TableColumn } from '@nuxt/ui'
import type { AdminUserSummary } from '@webvue/contracts'
import type { RouteLocationRaw } from 'vue-router'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'

// The users table on SharedDataTable (the settings list and a role's assigned users). A row opens the
// account through `toFor` (background click, Enter and the name link). Pagination belongs to the page.
const props = defineProps<{
  users: AdminUserSummary[]
  loading?: boolean
  error?: unknown
  emptyText?: string
  toFor?: (user: AdminUserSummary) => RouteLocationRaw
}>()
defineEmits<{ retry: [] }>()
const { t, locale } = useI18n()
const roleLabel = (role: { name: { ar: string; en: string | null } }) => role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar
const rolesOf = (user: AdminUserSummary) => user.assignments.map(assignment => roleLabel(assignment.role)).join('، ') || t('access.users.noRoles')
const userTo = (user: AdminUserSummary): RouteLocationRaw => props.toFor?.(user) ?? `/settings/users/${user.id}`
const { can } = useAccess()
const badge = (user: AdminUserSummary) => accessBadge({ active: user.active, protected: user.protected })
const actionsFor = (user: AdminUserSummary): RowAction[] => [
  { label: t('access.view'), icon: 'i-lucide-eye', to: userTo(user) },
  ...(can('access.users.assign_roles') ? [{ label: t('access.users.editAccess'), icon: 'i-lucide-user-cog', to: `/settings/users/${user.id}/access` } satisfies RowAction] : []),
  ...(can('access.users.read') ? [{ label: t('access.users.security'), icon: 'i-lucide-shield', to: `/settings/users/${user.id}/security` } satisfies RowAction] : []),
]

const columns = computed<TableColumn<AdminUserSummary>[]>(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t) },
  { accessorKey: 'name', header: t('access.users.columns.name') },
  { accessorKey: 'login', header: t('access.users.columns.loginName') },
  { accessorKey: 'employee', header: t('access.users.columns.employee') },
  { accessorKey: 'roles', header: t('access.users.columns.roles') },
  { accessorKey: 'active', header: t('access.users.columns.status') },
  { accessorKey: 'actions', header: t('access.users.columns.actions') },
])
</script>

<template>
  <SharedDataTable
    :rows="users" :columns="columns" row-key="id" :row-to="userTo" :loading="loading" :error="error"
    :empty-text="emptyText" :caption="t('access.users.title')" @retry="$emit('retry')"
  >
    <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
    <template #name-cell="{ row }">
      <NuxtLink :to="userTo(row.original)" class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.name }}</NuxtLink>
    </template>
    <template #login-cell="{ row }"><bdi dir="ltr">{{ row.original.login }}</bdi></template>
    <template #employee-cell="{ row }">{{ row.original.employee?.name ?? t('access.users.noEmployee') }}</template>
    <template #roles-cell="{ row }">{{ rolesOf(row.original) }}</template>
    <template #active-cell="{ row }"><SharedStatusBadge :tone="badge(row.original).tone" :label="t(badge(row.original).labelKey)" :icon="badge(row.original).icon" /></template>
    <template #actions-cell="{ row }">
      <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t('access.users.rowActions', { name: row.original.name })" /></div>
    </template>
    <template #mobile-row="{ row }">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <bdi class="block text-xs text-muted">#{{ row.id }}</bdi>
          <NuxtLink :to="userTo(row)" class="font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.name }}</NuxtLink>
        </div>
        <SharedStatusBadge :tone="badge(row).tone" :label="t(badge(row).labelKey)" :icon="badge(row).icon" />
      </div>
      <dl class="mt-3 grid grid-cols-1 gap-2 text-xs text-muted">
        <div><dt>{{ t('access.users.columns.loginName') }}</dt><dd dir="ltr">{{ row.login }}</dd></div>
        <div><dt>{{ t('access.users.columns.employee') }}</dt><dd>{{ row.employee?.name ?? t('access.users.noEmployee') }}</dd></div>
        <div><dt>{{ t('access.users.columns.roles') }}</dt><dd>{{ rolesOf(row) }}</dd></div>
      </dl>
      <div class="mt-3 flex justify-end"><SharedRowActions :actions="actionsFor(row)" :label="t('access.users.rowActions', { name: row.name })" /></div>
    </template>
  </SharedDataTable>
</template>
