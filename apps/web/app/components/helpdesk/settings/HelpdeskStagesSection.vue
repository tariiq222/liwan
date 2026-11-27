<script setup lang="ts">
import type { HelpdeskStageResource, HelpdeskTeamResource } from '@liwan/contracts'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { useSaveHelpdeskResource } from '@/composables/helpdesk/useHelpdeskResources'
import { saveErrorMessage } from '@/utils/formFeedback'

// The stages of the desk and what each one means: closed tickets stay closed, an unattended stage waits on the
// customer, and a folded one collapses in the board. Creating opens the slideover, editing opens the edit page;
// a stage with open tickets is archived only after they move.
const props = defineProps<{ rows: HelpdeskStageResource[]; teams: HelpdeskTeamResource[]; canEdit: boolean }>()
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const save = useSaveHelpdeskResource('stages')
const failure = ref<string | null>(null)

async function archive(row: HelpdeskStageResource, active: boolean) {
  if (!hydrated.value || !props.canEdit || save.isPending.value) return
  failure.value = null
  try {
    await save.mutateAsync({ id: row.id, name: row.name, active })
  } catch (cause) {
    failure.value = saveErrorMessage(cause, t('helpdesk.settings.resources.failed'), t('errors.saveUncertain'))
  }
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('helpdesk.settings.stages.title')" data-testid="helpdesk-settings-stages">
    <template #actions>
      <UButton
        v-if="props.canEdit"
        :to="{ path: '/settings/apps/helpdesk/stages/new', query: returnToQuery(route.fullPath) }"
        icon="i-lucide-plus"
        :disabled="!hydrated"
        :label="t('helpdesk.settings.stages.add')"
        data-testid="helpdesk-stage-add"
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
      data-testid="helpdesk-stages-error"
    />
    <ul class="flex flex-col divide-y divide-default">
      <li v-for="row in props.rows" :key="row.id" class="flex flex-wrap items-center justify-between gap-2 py-2" :data-testid="`helpdesk-stage-${row.id}`">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <span class="text-sm font-medium text-highlighted">{{ row.name }}</span>
          <SharedStatusBadge v-if="row.closed" tone="success" :label="t('helpdesk.settings.stages.closed')" size="sm" />
          <SharedStatusBadge v-if="row.unattended" tone="warning" :label="t('helpdesk.settings.stages.unattended')" size="sm" />
          <SharedStatusBadge v-if="row.shared" tone="neutral" :label="t('helpdesk.settings.stages.shared')" size="sm" />
          <SharedStatusBadge v-if="!row.active" tone="neutral" :label="t('helpdesk.settings.resources.archived')" size="sm" />
        </div>
        <div class="flex items-center gap-2">
          <UButton
            v-if="props.canEdit && !row.shared"
            :to="{ path: `/settings/apps/helpdesk/stages/${row.id}/edit`, query: returnToQuery(route.fullPath) }"
            color="neutral"
            variant="ghost"
            icon="i-lucide-pencil"
            size="xs"
            :disabled="!hydrated"
            :aria-label="t('app.edit')"
          />
          <USwitch
            v-if="props.canEdit && !row.shared"
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
