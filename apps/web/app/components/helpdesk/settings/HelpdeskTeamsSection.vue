<script setup lang="ts">
import type { HelpdeskTeamResource } from '@liwan/contracts'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { useSaveHelpdeskResource } from '@/composables/helpdesk/useHelpdeskResources'
import { saveErrorMessage } from '@/utils/formFeedback'

// The support teams and their members. Creating opens the route-backed slideover, editing opens the edit page;
// archiving is refused by the server while the team still holds open tickets.
const props = defineProps<{ rows: HelpdeskTeamResource[]; canEdit: boolean }>()
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const save = useSaveHelpdeskResource('teams')
const failure = ref<string | null>(null)

async function archive(row: HelpdeskTeamResource, active: boolean) {
  if (!hydrated.value || !props.canEdit || save.isPending.value) return
  failure.value = null
  try {
    await save.mutateAsync({ id: row.id, name: row.name, active })
  } catch (cause) {
    failure.value = saveErrorMessage(cause, t('helpdesk.settings.resources.failed'), t('errors.saveUncertain'))
  }
}

const membersText = (row: HelpdeskTeamResource) => joinList(row.member_ids.map(member => member.name), t)
const leaderName = (row: HelpdeskTeamResource) => row.member_ids.find(member => member.id === row.leader_id)?.name ?? '—'
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('helpdesk.settings.teams.title')" data-testid="helpdesk-settings-teams">
    <template #actions>
      <UButton
        v-if="props.canEdit"
        :to="{ path: '/settings/apps/helpdesk/teams/new', query: returnToQuery(route.fullPath) }"
        icon="i-lucide-plus"
        :disabled="!hydrated"
        :label="t('helpdesk.settings.teams.add')"
        data-testid="helpdesk-team-add"
      />
      <UBadge v-else color="neutral" variant="subtle" :label="t('app.viewOnly')" />
    </template>
    <UAlert
      v-if="failure"
      role="alert"
      color="error"
      variant="subtle"
      class="mb-2"
      :title="t('app.saveFailed')"
      :description="failure"
      data-testid="helpdesk-teams-error"
    />
    <ul class="flex flex-col divide-y divide-default">
      <li v-for="row in props.rows" :key="row.id" class="flex flex-wrap items-center justify-between gap-2 py-2" :data-testid="`helpdesk-team-${row.id}`">
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-highlighted">{{ row.name }}</p>
          <p class="truncate text-sm text-muted">
            {{ t('helpdesk.settings.teams.leader') }}: {{ leaderName(row) }}
            <span v-if="membersText(row)"> · {{ membersText(row) }}</span>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <SharedStatusBadge v-if="!row.active" tone="neutral" :label="t('helpdesk.settings.resources.archived')" size="sm" />
          <UButton
            v-if="props.canEdit"
            :to="{ path: `/settings/apps/helpdesk/teams/${row.id}/edit`, query: returnToQuery(route.fullPath) }"
            color="neutral"
            variant="ghost"
            icon="i-lucide-pencil"
            size="xs"
            :disabled="!hydrated"
            :aria-label="t('app.edit')"
          />
          <USwitch
            v-if="props.canEdit"
            :model-value="row.active"
            :aria-label="t('helpdesk.settings.resources.active')"
            :disabled="!hydrated || save.isPending.value"
            @update:model-value="value => archive(row, value === true)"
          />
        </div>
      </li>
    </ul>
  </SharedRecordSection>
</template>
