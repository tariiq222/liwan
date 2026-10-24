<script setup lang="ts">
import { AUDIT_ACTION_LABELS } from '@/components/access/audit/auditActionLabels'
import { auditDiffLines } from '@/components/access/auditDiff'
import { adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.eventId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const returnTo = computed(() => {
  return adminPathWithQuery('/settings/team/access-log', adminListQuery(route.query, ['from', 'to', 'actor_id', 'target_type', 'target_id', 'action', 'offset']))
})
const forbidden = computed(() => !can('access.audit.read'))
const event = useAdminAuditEvent(computed(() => validId.value ? id.value : null), computed(() => !forbidden.value))
const pageError = computed(() => event.error.value ?? (validId.value || forbidden.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const diff = computed(() => auditDiffLines(event.data.value?.before, event.data.value?.after))
const actionLabels = AUDIT_ACTION_LABELS
</script>

<template>
  <SharedRecordPage :keep-content="!!event.data.value"
    data-testid="settings-layout"
    :title="t('access.audit.detailTitle')"
    :back-to="returnTo"
    :loading="event.isLoading.value"
    :error="pageError"
    @retry="event.refetch"
  >
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedPageState v-else :empty="!event.data.value" :empty-text="t('access.notFound')">
      <template v-if="event.data.value">
        <SharedRecordSection v-for="side in (['before', 'after'] as const)" :id="side" :key="side" variant="panel" :title="t(`access.audit.${side}`)">
          <template #actions>
            <SharedStatusBadge size="sm" :tone="side === 'before' ? 'destructive' : 'success'" :label="t(side === 'before' ? 'access.roles.removed' : 'access.roles.added')" />
          </template>
          <pre class="overflow-x-auto rounded-control bg-elevated/40 py-2 text-xs leading-6" dir="ltr"><span v-for="(line, index) in diff[side]" :key="index" class="block px-3" :class="line.changed ? (side === 'before' ? 'bg-error/10 text-error' : 'bg-success/10 text-success') : ''">{{ line.text }}</span></pre>
        </SharedRecordSection>
      </template>
    </SharedPageState>
    <template v-if="event.data.value && !forbidden" #summary>
      <SharedPropertiesPanel id="event" :title="t('access.audit.detailTitle')">
        <SharedPropertyRow :label="t('access.audit.columns.time')"><bdi dir="ltr">{{ event.data.value.occurred_at }}</bdi></SharedPropertyRow>
        <SharedPropertyRow :label="t('access.audit.columns.actor')" :value="event.data.value.actor?.name ?? t('access.audit.system')" />
        <SharedPropertyRow :label="t('access.audit.columns.action')" :value="t(actionLabels[event.data.value.action])" />
        <SharedPropertyRow :label="t('access.audit.columns.target')" :value="event.data.value.target.name" />
        <SharedPropertyRow v-if="event.data.value.reason" :label="t('access.audit.reason')" :value="event.data.value.reason" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
