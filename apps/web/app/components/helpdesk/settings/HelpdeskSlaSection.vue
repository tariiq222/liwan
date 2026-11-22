<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { HelpdeskSlaPolicy, HelpdeskStageResource, HelpdeskTeamResource, HelpdeskResource, HelpdeskCategoryResource } from '@liwan/contracts'
import { useArchiveHelpdeskSla, useSaveHelpdeskSla } from '@/composables/helpdesk/useHelpdeskSla'

// The service levels of the desk: the target stage, how long a ticket may take to reach it, and who the policy covers.
// A ticket meets the level when it reaches the target stage; the stages marked "paused" stop the clock.
const props = defineProps<{
  rows: HelpdeskSlaPolicy[]
  stages: HelpdeskStageResource[]
  teams: HelpdeskTeamResource[]
  categories: HelpdeskCategoryResource[]
  tags: HelpdeskResource[]
  canEdit: boolean
}>()
const { t } = useI18n()
const save = useSaveHelpdeskSla()
const archive = useArchiveHelpdeskSla()
const editing = ref<number | 'new' | null>(null)
const failure = ref<string | null>(null)
const form = reactive({
  name: '',
  days: 0,
  hours: 4,
  stageId: null as number | null,
  teamIds: [] as number[],
  categoryIds: [] as number[],
  tagIds: [] as number[],
  ignoreStageIds: [] as number[],
})

const selectableStages = computed(() => props.stages.filter(stage => !stage.closed && stage.active))
const stageItems = computed(() => selectableStages.value.map(stage => ({ value: stage.id, label: stage.name })))
const pauseItems = computed(() => props.stages.map(stage => ({ value: stage.id, label: stage.name })))
const teamItems = computed(() => props.teams.map(team => ({ value: team.id, label: team.name })))
const categoryItems = computed(() => props.categories.map(row => ({ value: row.id, label: row.name })))
const tagItems = computed(() => props.tags.map(row => ({ value: row.id, label: row.name })))
const stageName = (id: number | null) => props.stages.find(stage => stage.id === id)?.name ?? '—'
const scopeText = (policy: HelpdeskSlaPolicy) => joinList(policy.team_ids
  .map(id => props.teams.find(team => team.id === id)?.name)
  .filter((name): name is string => Boolean(name)), t) || t('helpdesk.settings.sla.everyTeam')

function start(policy?: HelpdeskSlaPolicy) {
  failure.value = null
  editing.value = policy?.id ?? 'new'
  form.name = policy?.name ?? ''
  form.days = policy?.days ?? 0
  form.hours = policy?.hours ?? 4
  form.stageId = policy?.stage_id ?? selectableStages.value[0]?.id ?? null
  form.teamIds = policy ? [...policy.team_ids] : []
  form.categoryIds = policy ? [...policy.category_ids] : []
  form.tagIds = policy ? [...policy.tag_ids] : []
  form.ignoreStageIds = policy ? [...policy.ignore_stage_ids] : []
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
      days: form.days,
      hours: form.hours,
      stage_id: form.stageId as number,
      team_ids: form.teamIds,
      category_ids: form.categoryIds,
      tag_ids: form.tagIds,
      ignore_stage_ids: form.ignoreStageIds,
    })
    cancel()
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.settings.resources.failed')
  }
}

async function toggle(policy: HelpdeskSlaPolicy, active: boolean) {
  failure.value = null
  try {
    await archive.mutateAsync({ id: policy.id, active })
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.settings.resources.failed')
  }
}
const duration = (policy: HelpdeskSlaPolicy) => {
  const parts: string[] = []
  if (policy.days) parts.push(t('helpdesk.settings.sla.days', { count: policy.days }))
  if (policy.hours) parts.push(t('helpdesk.settings.sla.hours', { count: policy.hours }))
  return parts.join(' ')
}
const busy = computed(() => save.isPending.value || archive.isPending.value)
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('helpdesk.settings.sla.title')" data-testid="helpdesk-settings-sla">
    <template #actions>
      <UButton v-if="props.canEdit && editing === null" color="neutral" variant="outline" icon="i-lucide-plus" size="xs" :label="t('helpdesk.settings.sla.add')" data-testid="helpdesk-sla-add" @click="start()" />
    </template>
    <p class="mb-2 text-sm text-muted">{{ t('helpdesk.settings.sla.hint') }}</p>
    <p v-if="failure" class="mb-2 text-sm text-error" role="alert" data-testid="helpdesk-sla-error">{{ failure }}</p>
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
          <UButton v-if="props.canEdit" color="neutral" variant="ghost" icon="i-lucide-pencil" size="xs" :aria-label="t('app.edit')" @click="start(policy)" />
          <USwitch v-if="props.canEdit" :model-value="policy.active" :aria-label="t('helpdesk.settings.resources.active')" :disabled="busy" @update:model-value="value => toggle(policy, value === true)" />
        </div>
      </li>
    </ul>
    <form v-if="props.canEdit && editing !== null" class="mt-3 flex flex-col gap-3 rounded-control border border-default p-3" data-testid="helpdesk-sla-form" @submit.prevent="submit">
      <UFormField :label="t('helpdesk.settings.sla.name')" required>
        <UInput v-model="form.name" class="w-full" :maxlength="120" data-testid="helpdesk-sla-name" />
      </UFormField>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField :label="t('helpdesk.settings.sla.daysLabel')">
          <UInputNumber v-model="form.days" class="w-full" :min="0" :max="365" data-testid="helpdesk-sla-days" />
        </UFormField>
        <UFormField :label="t('helpdesk.settings.sla.hoursLabel')">
          <UInputNumber v-model="form.hours" class="w-full" :min="0" :max="23" data-testid="helpdesk-sla-hours" />
        </UFormField>
      </div>
      <UFormField :label="t('helpdesk.settings.sla.target')" :help="t('helpdesk.settings.sla.targetHint')" required>
        <USelect :model-value="form.stageId ?? undefined" :items="stageItems" class="w-full" data-testid="helpdesk-sla-stage" @update:model-value="value => { form.stageId = Number(value) }" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.sla.teams')" :help="t('helpdesk.settings.sla.teamsHint')">
        <USelectMenu v-model="form.teamIds" :items="teamItems" multiple value-key="value" class="w-full" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.sla.categories')">
        <USelectMenu v-model="form.categoryIds" :items="categoryItems" multiple value-key="value" class="w-full" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.sla.tags')">
        <USelectMenu v-model="form.tagIds" :items="tagItems" multiple value-key="value" class="w-full" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.sla.pauseStages')" :help="t('helpdesk.settings.sla.pauseHint')">
        <USelectMenu v-model="form.ignoreStageIds" :items="pauseItems" multiple value-key="value" class="w-full" />
      </UFormField>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" :label="t('app.cancel')" :disabled="busy" @click="cancel" />
        <UButton type="submit" :loading="busy" :label="t('helpdesk.settings.resources.save')" data-testid="helpdesk-sla-save" />
      </div>
    </form>
  </SharedRecordSection>
</template>
