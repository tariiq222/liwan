<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { HelpdeskTeamResource } from '@liwan/contracts'
import { useSaveHelpdeskResource } from '@/composables/helpdesk/useHelpdeskResources'

// The support teams and their members. A team is saved whole: its name, the members that may answer its tickets and
// the leader among them; archiving is refused by the server while the team still holds open tickets.
const props = defineProps<{ rows: HelpdeskTeamResource[]; canEdit: boolean }>()
const { t } = useI18n()
const save = useSaveHelpdeskResource('teams')
const editing = ref<number | 'new' | null>(null)
const failure = ref<string | null>(null)
const form = reactive({ name: '', member_ids: [] as number[], leader_id: null as number | null })
const known = ref<{ id: number; name: string }[]>([])

function start(row?: HelpdeskTeamResource) {
  failure.value = null
  editing.value = row?.id ?? 'new'
  form.name = row?.name ?? ''
  form.member_ids = row ? row.member_ids.map(member => member.id) : []
  form.leader_id = row?.leader_id ?? null
  known.value = row?.member_ids ?? []
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
      member_ids: form.member_ids,
      leader_id: form.leader_id,
    })
    cancel()
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.settings.resources.failed')
  }
}

async function archive(row: HelpdeskTeamResource, active: boolean) {
  failure.value = null
  try {
    await save.mutateAsync({ id: row.id, name: row.name, active })
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.settings.resources.failed')
  }
}

const membersText = (row: HelpdeskTeamResource) => joinList(row.member_ids.map(member => member.name), t)
const leaderName = (row: HelpdeskTeamResource) => row.member_ids.find(member => member.id === row.leader_id)?.name ?? '—'
const memberOptions = computed(() => known.value.map(member => ({ id: member.id, name: member.name })))
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('helpdesk.settings.teams.title')" data-testid="helpdesk-settings-teams">
    <template #actions>
      <UButton v-if="props.canEdit && editing === null" color="neutral" variant="outline" icon="i-lucide-plus" size="xs" :label="t('helpdesk.settings.teams.add')" data-testid="helpdesk-team-add" @click="start()" />
    </template>
    <p v-if="failure" class="mb-2 text-sm text-error" role="alert" data-testid="helpdesk-teams-error">{{ failure }}</p>
    <ul class="flex flex-col divide-y divide-default">
      <li v-for="row in props.rows" :key="row.id" class="flex flex-wrap items-center justify-between gap-2 py-2" :data-testid="`helpdesk-team-${row.id}`">
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-highlighted">{{ row.name }}</p>
          <p class="truncate text-sm text-muted">{{ t('helpdesk.settings.teams.leader') }}: {{ leaderName(row) }}
            <span v-if="membersText(row)"> · {{ membersText(row) }}</span></p>
        </div>
        <div class="flex items-center gap-2">
          <SharedStatusBadge v-if="!row.active" tone="neutral" :label="t('helpdesk.settings.resources.archived')" size="sm" />
          <UButton v-if="props.canEdit" color="neutral" variant="ghost" icon="i-lucide-pencil" size="xs" :aria-label="t('app.edit')" @click="start(row)" />
          <USwitch v-if="props.canEdit" :model-value="row.active" :aria-label="t('helpdesk.settings.resources.active')" :disabled="save.isPending.value" @update:model-value="value => archive(row, value === true)" />
        </div>
      </li>
    </ul>
    <form v-if="props.canEdit && editing !== null" class="mt-3 flex flex-col gap-3 rounded-control border border-default p-3" data-testid="helpdesk-team-form" @submit.prevent="submit">
      <UFormField :label="t('helpdesk.settings.resources.name')" required>
        <UInput v-model="form.name" class="w-full" :maxlength="64" data-testid="helpdesk-team-name" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.teams.members')">
        <SharedPersonPicker v-model="form.member_ids" multiple :known="memberOptions" :aria-label="t('helpdesk.settings.teams.members')" @update:model-value="() => { form.leader_id = null }" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.teams.leader')">
        <SharedPersonPicker v-model="form.leader_id" :known="memberOptions" :options="memberOptions" :aria-label="t('helpdesk.settings.teams.leader')" />
      </UFormField>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" :label="t('app.cancel')" :disabled="save.isPending.value" @click="cancel" />
        <UButton type="submit" :loading="save.isPending.value" :label="t('helpdesk.settings.resources.save')" data-testid="helpdesk-team-save" />
      </div>
    </form>
  </SharedRecordSection>
</template>
