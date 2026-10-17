<script setup lang="ts">
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import type { TableColumn } from '@nuxt/ui'
import type { AccessAuditSummary } from '@webvue/contracts'
import type { RouteLocationRaw } from 'vue-router'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import { formatWebVueDateTime } from '@webvue/ui/app/composables/calendarDate'

// The access-log table on SharedDataTable: a row (background click, Enter, the time link) opens the event
// through `toFor`. Filters and pagination belong to the page.
const props = defineProps<{
  events: AccessAuditSummary[]
  toFor: (id: number) => RouteLocationRaw
  loading?: boolean
  error?: unknown
  emptyText?: string
}>()
defineEmits<{ retry: [] }>()
const { t, locale } = useI18n()
const actionLabels: Record<AccessAuditSummary['action'], string> = {
  'user.granted': 'access.audit.actions.userGranted',
  'user.roles_changed': 'access.audit.actions.userRolesChanged',
  'user.disabled': 'access.audit.actions.userDisabled',
  'user.reactivated': 'access.audit.actions.userReactivated',
  'user.password_reset': 'access.audit.actions.userPasswordReset',
  'employee.archived_access_disabled': 'access.audit.actions.employeeArchived',
  'role.created': 'access.audit.actions.roleCreated',
  'role.updated': 'access.audit.actions.roleUpdated',
  'role.disabled': 'access.audit.actions.roleDisabled',
  'role.enabled': 'access.audit.actions.roleEnabled',
  'role.deleted': 'access.audit.actions.roleDeleted',
  'migration.legacy_admin_preserved': 'access.audit.actions.legacyAdminPreserved',
}
const actionLabel = (action: AccessAuditSummary['action']) => t(actionLabels[action])
const eventTo = (event: AccessAuditSummary) => props.toFor(event.id)
const when = (event: AccessAuditSummary) => formatWebVueDateTime(event.occurred_at, locale.value)
const actionsFor = (event: AccessAuditSummary) => [{ label: t('access.view'), to: eventTo(event) }]
const columns = computed<TableColumn<AccessAuditSummary>[]>(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { accessorKey: 'occurred_at', header: t('access.audit.columns.time') },
  { accessorKey: 'actor', header: t('access.audit.columns.actor') },
  { accessorKey: 'action', header: t('access.audit.columns.action') },
  { accessorKey: 'target', header: t('access.audit.columns.target') },
  { accessorKey: 'result', header: t('access.audit.columns.result') },
  { id: 'actions', header: t('app.actions') },
])
</script>

<template>
  <SharedEmptyState v-if="!loading && !error && !events.length" class="m-(--webvue-card-pad-dense)" :title="emptyText ?? t('app.noResults')" />
  <SharedDataTable
    v-else
    bare
    :rows="events" :columns="columns" row-key="id" :row-to="eventTo" :loading="loading" :error="error"
    :caption="t('access.audit.title')" @retry="$emit('retry')"
  >
    <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
    <template #occurred_at-cell="{ row }">
      <NuxtLink :to="eventTo(row.original)" dir="ltr" class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :aria-label="`${t('access.audit.detailTitle')}: ${when(row.original)}`">{{ when(row.original) }}</NuxtLink>
    </template>
    <template #actor-cell="{ row }">{{ row.original.actor?.name ?? t('access.audit.system') }}</template>
    <template #action-cell="{ row }">{{ actionLabel(row.original.action) }}</template>
    <template #target-cell="{ row }">{{ row.original.target.name }}</template>
    <template #result-cell><SharedStatusBadge tone="success" :label="t('access.audit.succeeded')" /></template>
    <template #actions-cell="{ row }">
      <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t('access.audit.rowActions', { name: actionLabel(row.original.action) })" /></div>
    </template>
    <template #mobile-row="{ row }">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <bdi class="block text-xs text-muted">#{{ row.id }}</bdi>
          <NuxtLink :to="eventTo(row)" class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ actionLabel(row.action) }}</NuxtLink>
        </div>
        <SharedStatusBadge tone="success" :label="t('access.audit.succeeded')" />
      </div>
      <dl class="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
        <div><dt>{{ t('access.audit.columns.time') }}</dt><dd dir="ltr">{{ when(row) }}</dd></div>
        <div><dt>{{ t('access.audit.columns.actor') }}</dt><dd>{{ row.actor?.name ?? t('access.audit.system') }}</dd></div>
        <div class="col-span-2"><dt>{{ t('access.audit.columns.target') }}</dt><dd>{{ row.target.name }}</dd></div>
      </dl>
      <div class="mt-3 flex justify-end"><SharedRowActions :actions="actionsFor(row)" :label="t('access.audit.rowActions', { name: actionLabel(row.action) })" /></div>
    </template>
  </SharedDataTable>
</template>
