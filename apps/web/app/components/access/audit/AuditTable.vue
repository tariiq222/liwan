<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AccessAuditSummary } from '@nasq/contracts'
import RecordNumber from '@/components/shared/RecordNumber.vue'

const props = defineProps<{ events: AccessAuditSummary[] }>()
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
])

function onSelectRow(_event: Event, row: { original: AccessAuditSummary }) {
  open(row.original.id)
}
</script>

<template>
  <div class="min-w-0 space-y-2">
    <UCard class="hidden overflow-hidden md:block" :ui="{ body: 'p-0' }">
      <div class="overflow-x-auto">
        <UTable :data="events" :columns="columns" :caption="t('access.audit.title')" :ui="{ caption: 'sr-only' }" @select="onSelectRow">
          <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
          <template #occurred_at-cell="{ row }">
            <UButton type="button" color="neutral" variant="link" dir="ltr" class="rounded p-0 text-start" :disabled="!hydrated" :aria-label="`${t('access.audit.detailTitle')}: ${d(new Date(row.original.occurred_at), 'short')}`" @click.stop="open(row.original.id)">{{ d(new Date(row.original.occurred_at), 'short') }}</UButton>
          </template>
          <template #actor-cell="{ row }">{{ row.original.actor?.name ?? t('access.audit.system') }}</template>
          <template #action-cell="{ row }">{{ actionLabel(row.original.action) }}</template>
          <template #target-cell="{ row }">{{ row.original.target.name }}</template>
          <template #result-cell><span class="text-success">{{ t('access.audit.succeeded') }}</span></template>
        </UTable>
      </div>
    </UCard>
    <ul class="md:hidden space-y-2" :aria-label="t('access.audit.title')">
      <li v-for="event in events" :key="event.id" class="cursor-pointer rounded-lg border border-default bg-default p-4 shadow-sm" tabindex="0" role="button" @click="open(event.id)" @keydown.enter.self="open(event.id)" @keydown.space.self.prevent="open(event.id)" >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <bdi class="block text-xs text-muted">#{{ event.id }}</bdi>
            <p class="font-medium">{{ actionLabel(event.action) }}</p>
          </div>
          <UBadge color="success" variant="subtle">{{ t('access.audit.succeeded') }}</UBadge>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
          <div><dt>{{ t('access.audit.columns.time') }}</dt><dd dir="ltr">{{ d(new Date(event.occurred_at), 'short') }}</dd></div>
          <div><dt>{{ t('access.audit.columns.actor') }}</dt><dd>{{ event.actor?.name ?? t('access.audit.system') }}</dd></div>
          <div class="col-span-2"><dt>{{ t('access.audit.columns.target') }}</dt><dd>{{ event.target.name }}</dd></div>
        </dl>
      </li>
    </ul>
  </div>
</template>
