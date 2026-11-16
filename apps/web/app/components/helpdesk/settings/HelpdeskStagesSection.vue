<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { HelpdeskStageResource, HelpdeskTeamResource } from '@liwan/contracts'
import { useSaveHelpdeskResource } from '@/composables/helpdesk/useHelpdeskResources'

// The stages of the desk and what each one means: closed tickets stay closed, an unattended stage waits on the
// customer, and a folded one collapses in the board. A stage with open tickets is archived only after they move.
const props = defineProps<{ rows: HelpdeskStageResource[]; teams: HelpdeskTeamResource[]; canEdit: boolean }>()
const { t } = useI18n()
const save = useSaveHelpdeskResource('stages')
const editing = ref<number | 'new' | null>(null)
const failure = ref<string | null>(null)
const form = reactive({ name: '', sequence: 10, closed: false, unattended: false, fold: false, team_ids: [] as number[] })

function start(row?: HelpdeskStageResource) {
  failure.value = null
  editing.value = row?.id ?? 'new'
  form.name = row?.name ?? ''
  form.sequence = row?.sequence ?? 10
  form.closed = row?.closed ?? false
  form.unattended = row?.unattended ?? false
  form.fold = row?.fold ?? false
  form.team_ids = row?.team_ids ?? []
}

function cancel() {
  editing.value = null
  failure.value = null
}

async function submit() {
  failure.value = null
  try {
    await save.mutateAsync({
      ...(editing.value === 'new' ? {} : { id: editing.value as number }),
      name: form.name.trim(),
      sequence: form.sequence,
      closed: form.closed,
      unattended: form.unattended,
      fold: form.fold,
      team_ids: form.team_ids,
    })
    cancel()
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.settings.resources.failed')
  }
}

async function archive(row: HelpdeskStageResource, active: boolean) {
  failure.value = null
  try {
    await save.mutateAsync({ id: row.id, name: row.name, active })
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.settings.resources.failed')
  }
}

const teamOptions = computed(() => props.teams.map(team => ({ value: team.id, label: team.name })))
</script>

<template>
  <SharedSubCard :title="t('helpdesk.settings.stages.title')" data-testid="helpdesk-settings-stages">
    <template #actions>
      <UButton v-if="props.canEdit && editing === null" color="neutral" variant="outline" icon="i-lucide-plus" size="xs" :label="t('helpdesk.settings.stages.add')" data-testid="helpdesk-stage-add" @click="start()" />
    </template>
    <p v-if="failure" class="mb-2 text-sm text-error" role="alert" data-testid="helpdesk-stages-error">{{ failure }}</p>
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
          <UButton v-if="props.canEdit && !row.shared" color="neutral" variant="ghost" icon="i-lucide-pencil" size="xs" :aria-label="t('app.edit')" @click="start(row)" />
          <USwitch v-if="props.canEdit && !row.shared" :model-value="row.active" :aria-label="t('helpdesk.settings.resources.active')" :disabled="save.isPending.value" @update:model-value="value => archive(row, value === true)" />
        </div>
      </li>
    </ul>
    <form v-if="props.canEdit && editing !== null" class="mt-3 flex flex-col gap-3 rounded-control border border-default p-3" data-testid="helpdesk-stage-form" @submit.prevent="submit">
      <UFormField :label="t('helpdesk.settings.resources.name')" required>
        <UInput v-model="form.name" class="w-full" :maxlength="64" data-testid="helpdesk-stage-name" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.stages.sequence')">
        <UInputNumber v-model="form.sequence" class="w-full" :min="0" :max="9999" />
      </UFormField>
      <div class="flex flex-wrap gap-4">
        <UCheckbox v-model="form.closed" :label="t('helpdesk.settings.stages.closed')" />
        <UCheckbox v-model="form.unattended" :label="t('helpdesk.settings.stages.unattended')" />
        <UCheckbox v-model="form.fold" :label="t('helpdesk.settings.stages.fold')" />
      </div>
      <UFormField :label="t('helpdesk.settings.stages.teams')" :help="t('helpdesk.settings.stages.teamsHint')">
        <USelectMenu v-model="form.team_ids" :items="teamOptions" multiple value-key="value" class="w-full" />
      </UFormField>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" :label="t('app.cancel')" :disabled="save.isPending.value" @click="cancel" />
        <UButton type="submit" :loading="save.isPending.value" :label="t('helpdesk.settings.resources.save')" data-testid="helpdesk-stage-save" />
      </div>
    </form>
  </SharedSubCard>
</template>
