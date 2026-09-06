<script setup lang="ts">
import type { AuditAction } from '@nasq/contracts'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
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
  <SettingsLayout>
    <div class="nasq-page-stack">
      <SharedPageHeader :title="t('access.audit.detailTitle')" :back-to="returnTo" />
      <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
      <SharedPageState v-else :loading="event.isLoading.value" :error="event.error.value" :empty="!event.data.value" :empty-text="t('access.notFound')" @retry="event.refetch">
        <template v-if="event.data.value">
          <section class="nasq-panel nasq-panel-body">
            <dl class="nasq-metadata">
              <div><dt>{{ t('access.audit.columns.time') }}</dt><dd dir="ltr">{{ event.data.value.occurred_at }}</dd></div>
              <div><dt>{{ t('access.audit.columns.actor') }}</dt><dd>{{ event.data.value.actor?.name ?? t('access.audit.system') }}</dd></div>
              <div><dt>{{ t('access.audit.columns.action') }}</dt><dd>{{ t(actionLabels[event.data.value.action]) }}</dd></div>
              <div><dt>{{ t('access.audit.columns.target') }}</dt><dd>{{ event.data.value.target.name }}</dd></div>
              <div v-if="event.data.value.reason"><dt>{{ t('access.audit.reason') }}</dt><dd>{{ event.data.value.reason }}</dd></div>
            </dl>
          </section>
          <div class="nasq-settings-cards mt-4">
            <section v-for="side in (['before', 'after'] as const)" :key="side" class="nasq-panel">
              <header class="nasq-panel-header"><h2 class="font-semibold">{{ t(`access.audit.${side}`) }}</h2></header>
              <div class="nasq-panel-body"><pre class="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-6" dir="ltr">{{ JSON.stringify(event.data.value[side], null, 2) }}</pre></div>
            </section>
          </div>
        </template>
      </SharedPageState>
    </div>
  </SettingsLayout>
</template>
