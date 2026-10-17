<script setup lang="ts">
import type { CharterDraft, DeliverableDraft, ObjectiveDraft } from '@/utils/projectCharter'
import { emptyDeliverable, emptyObjective } from '@/utils/projectCharter'
import ProjectFieldHelp from '@/components/pmo/projects/ProjectFieldHelp.vue'

const draft = defineModel<CharterDraft>({ required: true })
const props = withDefaults(defineProps<{
  readonly?: boolean
  disabled?: boolean
  showObjectives?: boolean
  showDeliverables?: boolean
}>(), { showObjectives: true, showDeliverables: true })

const { t } = useI18n()
const pendingRemove = ref<{ kind: 'objective' | 'deliverable'; key: string } | null>(null)

function helpLabel(field: string): string {
  return t('projects.charter.helpAria', { field })
}

function requestRemove(kind: 'objective' | 'deliverable', row: ObjectiveDraft | DeliverableDraft) {
  if (props.readonly || props.disabled) return
  if (!row.persisted) {
    removeRow(kind, row.key)
    return
  }
  pendingRemove.value = { kind, key: row.key }
}

function removeRow(kind: 'objective' | 'deliverable', key: string) {
  if (kind === 'objective') {
    draft.value.objectives = draft.value.objectives.filter((row) => row.key !== key)
    if (!draft.value.objectives.length) draft.value.objectives = [emptyObjective()]
  }
  else {
    draft.value.deliverables = draft.value.deliverables.filter((row) => row.key !== key)
    if (!draft.value.deliverables.length) draft.value.deliverables = [emptyDeliverable()]
  }
  pendingRemove.value = null
}

function addObjective() {
  draft.value.objectives = [...draft.value.objectives, emptyObjective()]
}

function addDeliverable() {
  draft.value.deliverables = [...draft.value.deliverables, emptyDeliverable()]
}
</script>

<template>
  <div class="grid gap-(--webvue-gap-section)">
    <section v-if="showObjectives" class="grid gap-3" data-testid="charter-field-objectives">
      <div class="flex items-center gap-1">
        <h2 class="text-base font-semibold text-highlighted">{{ t('projects.charter.fields.objectives') }}</h2>
        <ProjectFieldHelp
          :label="helpLabel(t('projects.charter.fields.objectives'))"
          :text="t('projects.charter.help.objectives')"
        />
      </div>
      <SharedSubCard
        v-for="(row, index) in draft.objectives"
        :key="row.key"
        class="grid gap-3"
        :data-testid="`charter-objective-${index}`"
      >
        <div class="grid gap-3 md:grid-cols-3">
          <UFormField :label="t('projects.charter.fields.objectiveGoal')">
            <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.objectiveGoal'))" :text="t('projects.charter.help.objectiveGoal')" /></template>
            <UInput
              :id="`objective-goal-${row.key}`"
              v-model="row.goal"
              class="w-full"
              :readonly="readonly"
              :disabled="disabled"
            />
          </UFormField>
          <UFormField :label="t('projects.charter.fields.objectiveMetric')">
            <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.objectiveMetric'))" :text="t('projects.charter.help.objectiveMetric')" /></template>
            <UInput
              :id="`objective-metric-${row.key}`"
              v-model="row.metric"
              class="w-full"
              :readonly="readonly"
              :disabled="disabled"
            />
          </UFormField>
          <UFormField :label="t('projects.charter.fields.objectiveTarget')">
            <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.objectiveTarget'))" :text="t('projects.charter.help.objectiveTarget')" /></template>
            <UInput
              :id="`objective-target-${row.key}`"
              v-model="row.target"
              class="w-full"
              :readonly="readonly"
              :disabled="disabled"
            />
          </UFormField>
        </div>
        <div v-if="!readonly" class="flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="ghost" size="sm" :disabled="disabled" :label="t('projects.charter.removeRow')" @click="requestRemove('objective', row)" />
        </div>
        <SharedInlineConfirm
          v-if="pendingRemove?.kind === 'objective' && pendingRemove.key === row.key"
          :title="t('projects.charter.removeRowConfirm')"
          :confirm-label="t('projects.charter.removeRow')"
          @cancel="pendingRemove = null"
          @confirm="removeRow('objective', row.key)"
        />
      </SharedSubCard>
      <UButton v-if="!readonly" type="button" color="neutral" size="sm" :disabled="disabled" icon="i-lucide-plus" :label="t('projects.charter.addObjective')" @click="addObjective" variant="outline" />
    </section>

    <section v-if="showDeliverables" class="grid gap-3" data-testid="charter-field-deliverables">
      <div class="flex items-center gap-1">
        <h2 class="text-base font-semibold text-highlighted">{{ t('projects.charter.fields.deliverables') }}</h2>
        <ProjectFieldHelp
          :label="helpLabel(t('projects.charter.fields.deliverables'))"
          :text="t('projects.charter.help.deliverables')"
        />
      </div>
      <SharedSubCard
        v-for="(row, index) in draft.deliverables"
        :key="row.key"
        class="grid gap-3"
        :data-testid="`charter-deliverable-${index}`"
      >
        <UFormField :label="t('projects.charter.fields.deliverableName')">
          <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.deliverableName'))" :text="t('projects.charter.help.deliverableName')" /></template>
          <UInput
            :id="`deliverable-name-${row.key}`"
            v-model="row.name"
            class="w-full"
            :readonly="readonly"
            :disabled="disabled"
          />
        </UFormField>
        <UFormField :label="t('projects.charter.fields.deliverableDescription')">
          <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.deliverableDescription'))" :text="t('projects.charter.help.deliverableDescription')" /></template>
          <UTextarea
            :id="`deliverable-description-${row.key}`"
            v-model="row.description"
            class="w-full"
            :readonly="readonly"
            :disabled="disabled"
            :rows="2"
          />
        </UFormField>
        <UFormField :label="t('projects.charter.fields.acceptance')" data-testid="charter-field-acceptance">
          <template #hint><ProjectFieldHelp :label="helpLabel(t('projects.charter.fields.acceptance'))" :text="t('projects.charter.help.acceptance')" /></template>
          <UTextarea
            :id="`deliverable-acceptance-${row.key}`"
            v-model="row.acceptance"
            class="w-full"
            :readonly="readonly"
            :disabled="disabled"
            :rows="2"
          />
        </UFormField>
        <div v-if="!readonly" class="flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="ghost" size="sm" :disabled="disabled" :label="t('projects.charter.removeRow')" @click="requestRemove('deliverable', row)" />
        </div>
        <SharedInlineConfirm
          v-if="pendingRemove?.kind === 'deliverable' && pendingRemove.key === row.key"
          :title="t('projects.charter.removeRowConfirm')"
          :confirm-label="t('projects.charter.removeRow')"
          @cancel="pendingRemove = null"
          @confirm="removeRow('deliverable', row.key)"
        />
      </SharedSubCard>
      <UButton v-if="!readonly" type="button" color="neutral" size="sm" :disabled="disabled" icon="i-lucide-plus" :label="t('projects.charter.addDeliverable')" @click="addDeliverable" variant="outline" />
    </section>
  </div>
</template>
