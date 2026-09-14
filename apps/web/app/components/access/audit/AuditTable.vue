<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AccessAuditSummary } from '@nasq/contracts'
import type { RouteLocationRaw } from 'vue-router'
import RecordNumber from '@/components/shared/RecordNumber.vue'

const props = defineProps<{ events: AccessAuditSummary[]; toFor: (id: number) => RouteLocationRaw }>()
const emit = defineEmits<{ open: [id: number] }>()
const { t, d } = useI18n()
const hydrated = useHydrated()
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
function open(id: number) { if (hydrated.value) emit('open', id) }

const columns = computed<TableColumn<AccessAuditSummary>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'occurred_at', header: t('access.audit.columns.time') },
  { accessorKey: 'actor', header: t('access.audit.columns.actor') },
  { accessorKey: 'action', header: t('access.audit.columns.action') },
  { accessorKey: 'target', header: t('access.audit.columns.target') },
  { accessorKey: 'result', header: t('access.audit.columns.result') },
  { id: 'actions', header: t('app.actions') },
])

function onSelectRow(event: Event, row: { original: AccessAuditSummary }) {
  if ((event.target as HTMLElement | null)?.closest('a, button')) return
  open(row.original.id)
}
const actionsFor = (event: AccessAuditSummary) => [{ label: t('access.view'), to: props.toFor(event.id) }]
</script>

<template>
  <div class="min-w-0 space-y-2">
    <div class="hidden overflow-hidden rounded-lg bg-default ring ring-default md:block">
      <div class="overflow-x-auto">
        <UTable :data="events" :columns="columns" :caption="t('access.audit.title')" :ui="{ caption: 'sr-only', th: '', tr: 'cursor-pointer' }" @select="onSelectRow">
          <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
          <template #occurred_at-cell="{ row }">
            <NuxtLink :to="toFor(row.original.id)" dir="ltr" class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :aria-label="`${t('access.audit.detailTitle')}: ${d(new Date(row.original.occurred_at), 'short')}`">{{ d(new Date(row.original.occurred_at), 'short') }}</NuxtLink>
          </template>
          <template #actor-cell="{ row }">{{ row.original.actor?.name ?? t('access.audit.system') }}</template>
          <template #action-cell="{ row }">{{ actionLabel(row.original.action) }}</template>
          <template #target-cell="{ row }">{{ row.original.target.name }}</template>
          <template #result-cell><UBadge color="success" variant="subtle">{{ t('access.audit.succeeded') }}</UBadge></template>
          <template #actions-cell="{ row }">
            <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t('access.audit.rowActions', { name: actionLabel(row.original.action) })" /></div>
          </template>
        </UTable>
      </div>
    </div>
    <ul class="divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default md:hidden" :aria-label="t('access.audit.title')">
      <li v-for="event in events" :key="event.id" class="p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <bdi class="block text-xs text-muted">#{{ event.id }}</bdi>
            <NuxtLink :to="toFor(event.id)" class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ actionLabel(event.action) }}</NuxtLink>
          </div>
          <UBadge color="success" variant="subtle">{{ t('access.audit.succeeded') }}</UBadge>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
          <div><dt>{{ t('access.audit.columns.time') }}</dt><dd dir="ltr">{{ d(new Date(event.occurred_at), 'short') }}</dd></div>
          <div><dt>{{ t('access.audit.columns.actor') }}</dt><dd>{{ event.actor?.name ?? t('access.audit.system') }}</dd></div>
          <div class="col-span-2"><dt>{{ t('access.audit.columns.target') }}</dt><dd>{{ event.target.name }}</dd></div>
        </dl>
        <div class="mt-3 flex justify-end">
          <SharedRowActions :actions="actionsFor(event)" :label="t('access.audit.rowActions', { name: actionLabel(event.action) })" />
        </div>
      </li>
    </ul>
  </div>
</template>
