<script setup lang="ts">
import type { HelpdeskCategoryResource, HelpdeskResource, HelpdeskSlaPolicy, HelpdeskStageResource, HelpdeskTeamResource } from '@liwan/contracts'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { useArchiveHelpdeskSla } from '@/composables/helpdesk/useHelpdeskSla'
import { saveErrorMessage } from '@/utils/formFeedback'

// The service levels of the desk: the target stage, how long a ticket may take to reach it, and who the policy covers.
// Creating opens the route-backed slideover, editing opens the edit page; the row switch archives or restores one.
const props = defineProps<{
  rows: HelpdeskSlaPolicy[]
  stages: HelpdeskStageResource[]
  teams: HelpdeskTeamResource[]
  categories: HelpdeskCategoryResource[]
  tags: HelpdeskResource[]
  canEdit: boolean
}>()
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const archive = useArchiveHelpdeskSla()
const failure = ref<string | null>(null)

const stageName = (id: number | null) => props.stages.find(stage => stage.id === id)?.name ?? '—'
const scopeText = (policy: HelpdeskSlaPolicy) => joinList(policy.team_ids
  .map(id => props.teams.find(team => team.id === id)?.name)
  .filter((name): name is string => Boolean(name)), t) || t('helpdesk.settings.sla.everyTeam')

async function toggle(policy: HelpdeskSlaPolicy, active: boolean) {
  if (!hydrated.value || !props.canEdit || archive.isPending.value) return
  failure.value = null
  try {
    await archive.mutateAsync({ id: policy.id, active })
  } catch (cause) {
    failure.value = saveErrorMessage(cause, t('helpdesk.settings.resources.failed'), t('errors.saveUncertain'))
  }
}

const duration = (policy: HelpdeskSlaPolicy) => {
  const parts: string[] = []
  if (policy.days) parts.push(t('helpdesk.settings.sla.days', { count: policy.days }))
  if (policy.hours) parts.push(t('helpdesk.settings.sla.hours', { count: policy.hours }))
  return parts.join(' ')
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('helpdesk.settings.sla.title')" data-testid="helpdesk-settings-sla">
    <template #actions>
      <UButton
        v-if="props.canEdit"
        :to="{ path: '/settings/apps/helpdesk/sla/new', query: returnToQuery(route.fullPath) }"
        icon="i-lucide-plus"
        :disabled="!hydrated"
        :label="t('helpdesk.settings.sla.add')"
        data-testid="helpdesk-sla-add"
      />
      <UBadge v-else color="neutral" variant="subtle" :label="t('app.viewOnly')" />
    </template>
    <p class="mb-2 text-sm text-muted">{{ t('helpdesk.settings.sla.hint') }}</p>
    <UAlert
      v-if="failure"
      role="alert"
      color="error"
      variant="subtle"
      class="mb-2"
      :title="t('app.saveFailed')"
      :description="failure"
      data-testid="helpdesk-sla-error"
    />
    <SharedEmptyState v-if="!props.rows.length" :title="t('helpdesk.settings.sla.empty')" />
    <ul v-else class="flex flex-col divide-y divide-default">
      <li v-for="policy in props.rows" :key="policy.id" class="flex flex-wrap items-center justify-between gap-2 py-2" :data-testid="`helpdesk-sla-${policy.id}`">
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2 text-sm font-medium text-highlighted">
            {{ policy.name }}
            <SharedStatusBadge v-if="!policy.active" tone="neutral" :label="t('helpdesk.settings.resources.archived')" size="sm" />
          </p>
          <p class="text-sm text-muted">
            {{ duration(policy) }} · {{ t('helpdesk.settings.sla.until') }} {{ stageName(policy.stage_id) }}
            <span v-if="policy.ignore_stage_ids.length"> · {{ t('helpdesk.settings.sla.paused', { count: policy.ignore_stage_ids.length }) }}</span>
          </p>
          <p class="text-sm text-muted">{{ scopeText(policy) }} · {{ t('helpdesk.settings.sla.covered', { count: policy.ticket_count }) }}</p>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            v-if="props.canEdit"
            :to="{ path: `/settings/apps/helpdesk/sla/${policy.id}/edit`, query: returnToQuery(route.fullPath) }"
            color="neutral"
            variant="ghost"
            icon="i-lucide-pencil"
            size="xs"
            :disabled="!hydrated"
            :aria-label="t('app.edit')"
          />
          <USwitch
            v-if="props.canEdit"
            :model-value="policy.active"
            :aria-label="t('helpdesk.settings.resources.active')"
            :disabled="!hydrated || archive.isPending.value"
            @update:model-value="value => toggle(policy, value === true)"
          />
        </div>
      </li>
    </ul>
  </SharedRecordSection>
</template>
