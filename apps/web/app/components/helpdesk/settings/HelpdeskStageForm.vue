<script setup lang="ts">
import type { HelpdeskStageResource, HelpdeskTeamResource } from '@liwan/contracts'
import { useSaveHelpdeskResource } from '@/composables/helpdesk/useHelpdeskResources'
import { saveErrorMessage } from '@/utils/formFeedback'

// Form for creating a support stage or editing an existing one: name, order, flags and the teams it serves.
const props = defineProps<{ stage?: HelpdeskStageResource; teams: readonly HelpdeskTeamResource[] }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const save = useSaveHelpdeskResource('stages')

const name = ref(props.stage?.name ?? '')
const sequence = ref(props.stage?.sequence ?? 10)
const closed = ref(props.stage?.closed ?? false)
const unattended = ref(props.stage?.unattended ?? false)
const fold = ref(props.stage?.fold ?? false)
const teamIds = ref<number[]>(props.stage ? [...props.stage.team_ids] : [])
const baseline = {
  name: name.value,
  sequence: sequence.value,
  closed: closed.value,
  unattended: unattended.value,
  fold: fold.value,
  teamIds: [...teamIds.value],
}
const submitted = ref(false)
const failure = ref<unknown>(null)

const teamOptions = computed(() => props.teams.map(team => ({ value: team.id, label: team.name })))
const valid = computed(() => name.value.trim() !== '')
const dirty = computed(() => !submitted.value && (
  name.value !== baseline.name
  || sequence.value !== baseline.sequence
  || closed.value !== baseline.closed
  || unattended.value !== baseline.unattended
  || fold.value !== baseline.fold
  || JSON.stringify(teamIds.value) !== JSON.stringify(baseline.teamIds)
))
const disabled = computed(() => !hydrated.value || save.isPending.value)

async function submit() {
  if (disabled.value || !valid.value) return
  failure.value = null
  try {
    await save.mutateAsync({
      ...(props.stage ? { id: props.stage.id } : {}),
      name: name.value.trim(),
      sequence: Number(sequence.value ?? 0),
      closed: closed.value,
      unattended: unattended.value,
      fold: fold.value,
      team_ids: teamIds.value,
    })
    submitted.value = true
    emit('done')
  } catch (cause) {
    failure.value = cause
  }
}
</script>

<template>
  <UForm :state="{ name }" class="liwan-form" method="post" :loading-auto="false" novalidate data-testid="helpdesk-stage-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert
      v-if="failure"
      role="alert"
      color="error"
      variant="subtle"
      :title="t('app.saveFailed')"
      :description="saveErrorMessage(failure, t('helpdesk.settings.resources.failed'), t('errors.saveUncertain'))"
      data-testid="helpdesk-stage-error"
    />
    <div class="liwan-auto-grid">
      <UFormField :label="t('helpdesk.settings.resources.name')" name="helpdesk-stage-name" required>
        <UInput id="helpdesk-stage-name" v-model="name" class="w-full" :maxlength="64" :disabled="disabled" required data-testid="helpdesk-stage-name" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.stages.sequence')" name="helpdesk-stage-sequence">
        <UInputNumber id="helpdesk-stage-sequence" :model-value="sequence" class="w-full" :min="0" :max="9999" :disabled="disabled" @update:model-value="value => { sequence = Number(value ?? 0) }" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.stages.teams')" name="helpdesk-stage-teams" :help="t('helpdesk.settings.stages.teamsHint')" class="liwan-span-full">
        <USelectMenu id="helpdesk-stage-teams" v-model="teamIds" :items="teamOptions" multiple value-key="value" class="w-full" :disabled="disabled" />
      </UFormField>
      <div class="liwan-span-full flex flex-wrap gap-4">
        <UCheckbox v-model="closed" :label="t('helpdesk.settings.stages.closed')" :disabled="disabled" />
        <UCheckbox v-model="unattended" :label="t('helpdesk.settings.stages.unattended')" :disabled="disabled" />
        <UCheckbox v-model="fold" :label="t('helpdesk.settings.stages.fold')" :disabled="disabled" />
      </div>
    </div>
    <SharedFormActions>
      <div class="ms-auto flex items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="save.isPending.value" :label="t('app.cancel')" @click="emit('cancel')" />
        <UButton type="submit" :disabled="disabled || !valid" :loading="save.isPending.value" :label="stage ? t('app.saveChanges') : t('app.create')" data-testid="helpdesk-stage-save" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
