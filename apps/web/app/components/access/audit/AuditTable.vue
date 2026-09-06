<script setup lang="ts">
import type { AccessAuditSummary } from '@nasq/contracts'

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
  <div class="overflow-x-auto rounded-lg border border-border/80 bg-card">
    <table class="w-full min-w-[680px] text-sm">
      <thead class="border-b border-border/80 bg-muted/50">
        <tr>
          <th class="p-3 text-start font-medium">{{ t('access.audit.columns.time') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.audit.columns.actor') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.audit.columns.action') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.audit.columns.target') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.audit.columns.result') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="event in events" :key="event.id" class="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-muted/50" @click="open(event.id)">
          <td class="p-3" dir="ltr">{{ d(new Date(event.occurred_at), 'short') }}</td>
          <td class="p-3">{{ event.actor?.name ?? t('access.audit.system') }}</td>
          <td class="p-3">{{ actionLabel(event.action) }}</td>
          <td class="p-3">{{ event.target.name }}</td>
          <td class="p-3 text-emerald-700 dark:text-emerald-300">{{ t('access.audit.succeeded') }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
