<script setup lang="ts">
import type { AccessAuditSummary } from '@nasq/contracts'
import RecordNumber from '@/components/shared/RecordNumber.vue'

defineProps<{ events: AccessAuditSummary[] }>()
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
</script>

<template>
  <div class="nasq-panel overflow-hidden">
    <div class="overflow-x-auto">
      <Table class="nasq-settings-table">
        <TableHeader>
          <TableRow>
            <TableHead class="w-28 text-start">{{ t('app.recordNumber') }}</TableHead>
            <TableHead class="text-start">{{ t('access.audit.columns.time') }}</TableHead>
            <TableHead class="text-start">{{ t('access.audit.columns.actor') }}</TableHead>
            <TableHead class="text-start">{{ t('access.audit.columns.action') }}</TableHead>
            <TableHead class="text-start">{{ t('access.audit.columns.target') }}</TableHead>
            <TableHead class="text-start">{{ t('access.audit.columns.result') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="event in events" :key="event.id" class="cursor-pointer" @click="open(event.id)">
            <TableCell class="w-28"><RecordNumber :value="event.id" /></TableCell>
            <TableCell dir="ltr">
              <button type="button" class="rounded text-start hover:underline" :disabled="!hydrated" :aria-label="`${t('access.audit.detailTitle')}: ${d(new Date(event.occurred_at), 'short')}`" @click.stop="open(event.id)">{{ d(new Date(event.occurred_at), 'short') }}</button>
            </TableCell>
            <TableCell>{{ event.actor?.name ?? t('access.audit.system') }}</TableCell>
            <TableCell>{{ actionLabel(event.action) }}</TableCell>
            <TableCell>{{ event.target.name }}</TableCell>
            <TableCell class="nasq-status-text-success">{{ t('access.audit.succeeded') }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
