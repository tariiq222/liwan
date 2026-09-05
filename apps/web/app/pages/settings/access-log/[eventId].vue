<script setup lang="ts">
import type { AuditAction } from '@nasq/contracts'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.eventId))
const returnTo = computed(() => {
  const query = new URLSearchParams()
  for (const key of ['from', 'to', 'actor_id', 'target_type', 'target_id', 'action', 'offset']) if (route.query[key]) query.set(key, String(route.query[key]))
  const suffix = query.toString()
  return `/settings/access-log${suffix ? `?${suffix}` : ''}`
})
const forbidden = computed(() => !can('access.audit.read'))
const event = useAdminAuditEvent(id, computed(() => !forbidden.value))
const actionLabels: Record<AuditAction, string> = {
  'user.granted': 'access.audit.actions.userGranted', 'user.roles_changed': 'access.audit.actions.userRolesChanged', 'user.disabled': 'access.audit.actions.userDisabled', 'user.reactivated': 'access.audit.actions.userReactivated', 'user.password_reset': 'access.audit.actions.userPasswordReset', 'employee.archived_access_disabled': 'access.audit.actions.employeeArchived', 'role.created': 'access.audit.actions.roleCreated', 'role.updated': 'access.audit.actions.roleUpdated', 'role.disabled': 'access.audit.actions.roleDisabled', 'role.enabled': 'access.audit.actions.roleEnabled', 'role.deleted': 'access.audit.actions.roleDeleted', 'migration.legacy_admin_preserved': 'access.audit.actions.legacyAdminPreserved',
}
</script>

<template>
  <div class="space-y-6">
    <SharedPageHeader :title="t('access.audit.detailTitle')" :back-to="returnTo" />
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <SharedPageState v-else :loading="event.isLoading.value" :error="event.error.value" :empty="!event.data.value" :empty-text="t('access.notFound')" @retry="event.refetch">
      <Card v-if="event.data.value"><CardContent class="space-y-4 p-6 text-sm"><p>{{ t('access.audit.columns.time') }}: <span dir="ltr">{{ event.data.value.occurred_at }}</span></p><p>{{ t('access.audit.columns.actor') }}: {{ event.data.value.actor?.name ?? t('access.audit.system') }}</p><p>{{ t('access.audit.columns.action') }}: {{ t(actionLabels[event.data.value.action]) }}</p><p>{{ t('access.audit.columns.target') }}: {{ event.data.value.target.name }}</p><div><h2 class="font-medium">{{ t('access.audit.before') }}</h2><pre class="overflow-auto rounded bg-muted p-3" dir="ltr">{{ JSON.stringify(event.data.value.before, null, 2) }}</pre></div><div><h2 class="font-medium">{{ t('access.audit.after') }}</h2><pre class="overflow-auto rounded bg-muted p-3" dir="ltr">{{ JSON.stringify(event.data.value.after, null, 2) }}</pre></div><p v-if="event.data.value.reason">{{ t('access.audit.reason') }}: {{ event.data.value.reason }}</p></CardContent></Card>
    </SharedPageState>
  </div>
</template>
