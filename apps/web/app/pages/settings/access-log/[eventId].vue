<script setup lang="ts">
import type { AuditAction } from '@nasq/contracts'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.eventId))
const returnTo = computed(() => {
  return adminPathWithQuery('/settings/access-log', adminListQuery(route.query, ['from', 'to', 'actor_id', 'target_type', 'target_id', 'action', 'offset']))
})
const forbidden = computed(() => !can('access.audit.read'))
const event = useAdminAuditEvent(id, computed(() => !forbidden.value))
const actionLabels: Record<AuditAction, string> = {
  'user.granted': 'access.audit.actions.userGranted', 'user.roles_changed': 'access.audit.actions.userRolesChanged', 'user.disabled': 'access.audit.actions.userDisabled', 'user.reactivated': 'access.audit.actions.userReactivated', 'user.password_reset': 'access.audit.actions.userPasswordReset', 'employee.archived_access_disabled': 'access.audit.actions.employeeArchived', 'role.created': 'access.audit.actions.roleCreated', 'role.updated': 'access.audit.actions.roleUpdated', 'role.disabled': 'access.audit.actions.roleDisabled', 'role.enabled': 'access.audit.actions.roleEnabled', 'role.deleted': 'access.audit.actions.roleDeleted', 'migration.legacy_admin_preserved': 'access.audit.actions.legacyAdminPreserved',
}
const sections = computed(() => event.data.value ? [
  { id: 'event', label: t('access.audit.detailTitle') },
  { id: 'before', label: t('access.audit.before') },
  { id: 'after', label: t('access.audit.after') },
] : [])
</script>

<template>
  <SettingsLayout :sections width="detail">
    <SharedPageHeader :title="t('access.audit.detailTitle')" :back-to="returnTo" />
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <SharedPageState v-else :loading="event.isLoading.value" :error="event.error.value" :empty="!event.data.value" :empty-text="t('access.notFound')" @retry="event.refetch">
      <template v-if="event.data.value">
        <div class="space-y-6">
          <UCard id="event" class="nasq-settings-anchor">
            <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('access.audit.detailTitle') }}</h2></template>
            <dl class="grid gap-4 sm:grid-cols-2">
              <div><dt class="text-sm text-muted">{{ t('access.audit.columns.time') }}</dt><dd class="mt-1 font-medium" dir="ltr">{{ event.data.value.occurred_at }}</dd></div>
              <div><dt class="text-sm text-muted">{{ t('access.audit.columns.actor') }}</dt><dd class="mt-1 font-medium">{{ event.data.value.actor?.name ?? t('access.audit.system') }}</dd></div>
              <div><dt class="text-sm text-muted">{{ t('access.audit.columns.action') }}</dt><dd class="mt-1 font-medium">{{ t(actionLabels[event.data.value.action]) }}</dd></div>
              <div><dt class="text-sm text-muted">{{ t('access.audit.columns.target') }}</dt><dd class="mt-1 font-medium">{{ event.data.value.target.name }}</dd></div>
              <div v-if="event.data.value.reason"><dt class="text-sm text-muted">{{ t('access.audit.reason') }}</dt><dd class="mt-1 font-medium">{{ event.data.value.reason }}</dd></div>
            </dl>
          </UCard>
          <UCard v-for="side in (['before', 'after'] as const)" :id="side" :key="side" class="nasq-settings-anchor">
            <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t(`access.audit.${side}`) }}</h2></template>
            <pre class="overflow-x-auto rounded-lg bg-elevated p-3 text-xs leading-6" dir="ltr">{{ JSON.stringify(event.data.value[side], null, 2) }}</pre>
          </UCard>
        </div>
      </template>
    </SharedPageState>
  </SettingsLayout>
</template>
