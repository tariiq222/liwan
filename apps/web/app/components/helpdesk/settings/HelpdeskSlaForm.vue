<script setup lang="ts">
import type { HelpdeskCategoryResource, HelpdeskResource, HelpdeskSlaPolicy, HelpdeskStageResource, HelpdeskTeamResource } from '@liwan/contracts'
import { useSaveHelpdeskSla } from '@/composables/helpdesk/useHelpdeskSla'
import { saveErrorMessage } from '@/utils/formFeedback'

// Form for creating a service-level policy or editing an existing one: target stage, duration, scope and pause stages.
const props = defineProps<{
  policy?: HelpdeskSlaPolicy
  stages: readonly HelpdeskStageResource[]
  teams: readonly HelpdeskTeamResource[]
  categories: readonly HelpdeskCategoryResource[]
  tags: readonly HelpdeskResource[]
}>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const save = useSaveHelpdeskSla()

const selectableStages = computed(() => props.stages.filter(stage => stage.active))
const stageItems = computed(() => {
  const active = selectableStages.value
  const currentId = props.policy?.stage_id ?? null
  const archivedCurrent = currentId !== null && !active.some(stage => stage.id === currentId)
    ? props.stages.find(stage => stage.id === currentId)
    : undefined
  const list = archivedCurrent ? [...active, archivedCurrent] : active
  return list.map(stage => ({ value: stage.id, label: stage.name }))
})
const pauseItems = computed(() => props.stages.map(stage => ({ value: stage.id, label: stage.name })))
const teamItems = computed(() => props.teams.map(team => ({ value: team.id, label: team.name })))
const categoryItems = computed(() => props.categories.map(row => ({ value: row.id, label: row.name })))
const tagItems = computed(() => props.tags.map(row => ({ value: row.id, label: row.name })))

const name = ref(props.policy?.name ?? '')
const days = ref(props.policy?.days ?? 0)
const hours = ref(props.policy?.hours ?? 4)
const stageId = ref<number | null>(props.policy?.stage_id ?? selectableStages.value[0]?.id ?? null)
const teamIds = ref<number[]>(props.policy ? [...props.policy.team_ids] : [])
const categoryIds = ref<number[]>(props.policy ? [...props.policy.category_ids] : [])
const tagIds = ref<number[]>(props.policy ? [...props.policy.tag_ids] : [])
const ignoreStageIds = ref<number[]>(props.policy ? [...props.policy.ignore_stage_ids] : [])
const baseline = {
  name: name.value,
  days: days.value,
  hours: hours.value,
  stageId: stageId.value,
  teamIds: [...teamIds.value],
  categoryIds: [...categoryIds.value],
  tagIds: [...tagIds.value],
  ignoreStageIds: [...ignoreStageIds.value],
}
const attempted = ref(false)
const submitted = ref(false)
const failure = ref<unknown>(null)

const nameError = computed(() => !name.value.trim() ? t('helpdesk.settings.resources.nameRequired') : undefined)
const stageError = computed(() => stageId.value === null ? t('helpdesk.settings.sla.targetRequired') : undefined)
const valid = computed(() => name.value.trim() !== '' && stageId.value !== null)
const dirty = computed(() => !submitted.value && (
  name.value !== baseline.name
  || days.value !== baseline.days
  || hours.value !== baseline.hours
  || stageId.value !== baseline.stageId
  || JSON.stringify(teamIds.value) !== JSON.stringify(baseline.teamIds)
  || JSON.stringify(categoryIds.value) !== JSON.stringify(baseline.categoryIds)
  || JSON.stringify(tagIds.value) !== JSON.stringify(baseline.tagIds)
  || JSON.stringify(ignoreStageIds.value) !== JSON.stringify(baseline.ignoreStageIds)
))
const disabled = computed(() => !hydrated.value || save.isPending.value)

async function submit() {
  attempted.value = true
  if (disabled.value || !valid.value || stageId.value === null) return
  failure.value = null
  try {
    await save.mutateAsync({
      ...(props.policy ? { id: props.policy.id } : {}),
      name: name.value.trim(),
      days: Number(days.value ?? 0),
      hours: Number(hours.value ?? 0),
      stage_id: stageId.value,
      team_ids: teamIds.value,
      category_ids: categoryIds.value,
      tag_ids: tagIds.value,
      ignore_stage_ids: ignoreStageIds.value,
    })
    submitted.value = true
    emit('done')
  } catch (cause) {
    failure.value = cause
  }
}
</script>

<template>
  <UForm :state="{ name }" class="liwan-form" method="post" :loading-auto="false" novalidate data-testid="helpdesk-sla-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert
      v-if="failure"
      role="alert"
      color="error"
      variant="subtle"
      :title="t('app.saveFailed')"
      :description="saveErrorMessage(failure, t('helpdesk.settings.resources.failed'), t('errors.saveUncertain'))"
      data-testid="helpdesk-sla-error"
    />
    <div class="liwan-auto-grid">
      <UFormField :label="t('helpdesk.settings.sla.name')" name="helpdesk-sla-name" required :error="attempted ? nameError : undefined" class="liwan-span-full">
        <UInput id="helpdesk-sla-name" v-model="name" class="w-full" :maxlength="120" :disabled="disabled" required data-testid="helpdesk-sla-name" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.sla.daysLabel')" name="helpdesk-sla-days">
        <UInputNumber id="helpdesk-sla-days" :model-value="days" class="w-full" :min="0" :max="365" :disabled="disabled" data-testid="helpdesk-sla-days" @update:model-value="value => { days = Number(value ?? 0) }" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.sla.hoursLabel')" name="helpdesk-sla-hours">
        <UInputNumber id="helpdesk-sla-hours" :model-value="hours" class="w-full" :min="0" :max="23" :disabled="disabled" data-testid="helpdesk-sla-hours" @update:model-value="value => { hours = Number(value ?? 0) }" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.sla.target')" name="helpdesk-sla-stage" :help="t('helpdesk.settings.sla.targetHint')" required :error="attempted ? stageError : undefined">
        <USelect id="helpdesk-sla-stage" :model-value="stageId ?? undefined" :items="stageItems" class="w-full" :disabled="disabled" data-testid="helpdesk-sla-stage" @update:model-value="value => { stageId = Number(value) }" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.sla.teams')" name="helpdesk-sla-teams" :help="t('helpdesk.settings.sla.teamsHint')">
        <USelectMenu id="helpdesk-sla-teams" v-model="teamIds" :items="teamItems" multiple value-key="value" class="w-full" :disabled="disabled" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.sla.categories')" name="helpdesk-sla-categories">
        <USelectMenu id="helpdesk-sla-categories" v-model="categoryIds" :items="categoryItems" multiple value-key="value" class="w-full" :disabled="disabled" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.sla.tags')" name="helpdesk-sla-tags">
        <USelectMenu id="helpdesk-sla-tags" v-model="tagIds" :items="tagItems" multiple value-key="value" class="w-full" :disabled="disabled" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.sla.pauseStages')" name="helpdesk-sla-pause" :help="t('helpdesk.settings.sla.pauseHint')" class="liwan-span-full">
        <USelectMenu id="helpdesk-sla-pause" v-model="ignoreStageIds" :items="pauseItems" multiple value-key="value" class="w-full" :disabled="disabled" />
      </UFormField>
    </div>
    <SharedFormActions>
      <div class="ms-auto flex items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="save.isPending.value" :label="t('app.cancel')" @click="emit('cancel')" />
        <UButton type="submit" :disabled="disabled" :loading="save.isPending.value" :label="policy ? t('app.saveChanges') : t('app.create')" data-testid="helpdesk-sla-save" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
