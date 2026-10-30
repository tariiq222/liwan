<script setup lang="ts">
import SettingsPreviewCard from '@/components/settings/SettingsPreviewCard.vue'
import SettingsPreviewList from '@/components/settings/SettingsPreviewList.vue'
import { useAdminAuditLog } from '@/composables/useAdminAudit'
import { useBranchPolicy } from '@/composables/useBranchAccess'
import { useAdminRoles } from '@/composables/useAdminRoles'
import { useAdminUsers } from '@/composables/useAdminUsers'
import { AUDIT_ACTION_LABELS } from '@/components/access/audit/auditActionLabels'
import { eventPreview, rolePreview, userPreview } from '@/utils/settingsPreview'

// The team settings: the latest users, roles and access-log events as compact preview cards, each linking to its full list.
const PREVIEW_ROWS = 5
const { t, te, locale } = useI18n()
const labels = computed(() => ({ t, te, locale: locale.value }))
const { parts, shows } = useSettingsPage('team')
const { can } = useAccess()
// The branches card names the company type chosen for the tenant; the policy is read only by those who may edit it.
const policy = useBranchPolicy(() => shows('branches') && can('access.users.assign_roles') && can('access.roles.read'))
const presetLabel = computed(() => policy.data.value ? t(`access.branches.presets.${policy.data.value.preset === 'custom' ? 'customName' : policy.data.value.preset}`) : '')
const users = useAdminUsers({ limit: PREVIEW_ROWS }, () => shows('users'))
const roles = useAdminRoles({ limit: PREVIEW_ROWS }, () => shows('roles'))
const events = useAdminAuditLog({ limit: PREVIEW_ROWS }, () => shows('access-log'))
const userRows = computed(() => (users.data.value?.items ?? []).map(user => userPreview(user, labels.value)))
const roleRows = computed(() => (roles.data.value?.items ?? []).map(role => rolePreview(role, labels.value)))
const eventRows = computed(() => (events.data.value?.items ?? []).map(event => eventPreview(event, t(AUDIT_ACTION_LABELS[event.action]), labels.value)))
</script>

<template>
  <SharedSettingsPage width="list">
    <SharedPageHeader :title="t('settings.sections.team.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('access.forbidden')" />
    <template v-else>
      <section v-if="shows('branches')" id="branches" class="webvue-settings-anchor">
        <SharedRecordSection :title="t('access.branches.title')" :description="presetLabel ? t('access.branches.currentPreset', { preset: presetLabel }) : t('access.branches.description')">
          <UButton to="/settings/team/branches" color="neutral" variant="outline" :label="t('access.branches.configure')" />
        </SharedRecordSection>
      </section>
      <section v-if="shows('users')" id="users" class="webvue-settings-anchor">
        <SettingsPreviewCard :title="t('access.users.title')" :all-label="t('settings.preview.allUsers')" all-to="/settings/team/users" test-id="team-users-preview">
          <SettingsPreviewList :items="userRows" :loading="users.isLoading.value" :error="users.error.value" :empty-text="t('access.users.empty')" @retry="users.refetch" />
        </SettingsPreviewCard>
      </section>
      <section v-if="shows('roles')" id="roles" class="webvue-settings-anchor">
        <SettingsPreviewCard :title="t('access.roles.title')" :all-label="t('settings.preview.allRoles')" all-to="/settings/team/roles" test-id="team-roles-preview">
          <SettingsPreviewList :items="roleRows" :loading="roles.isLoading.value" :error="roles.error.value" :empty-text="t('access.roles.empty')" @retry="roles.refetch" />
        </SettingsPreviewCard>
      </section>
      <section v-if="shows('access-log')" id="access-log" class="webvue-settings-anchor">
        <SettingsPreviewCard :title="t('access.audit.title')" :all-label="t('settings.preview.allAccessLog')" all-to="/settings/team/access-log" test-id="team-access-log-preview">
          <SettingsPreviewList :items="eventRows" :loading="events.isLoading.value" :error="events.error.value" :empty-text="t('access.audit.empty')" @retry="events.refetch" />
        </SettingsPreviewCard>
      </section>
    </template>
  </SharedSettingsPage>
</template>
