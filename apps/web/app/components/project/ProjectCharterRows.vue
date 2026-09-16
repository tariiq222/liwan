<script setup lang="ts">
import type { CharterDraft, DeliverableDraft, ObjectiveDraft } from '@/utils/projectCharter'
import { emptyDeliverable, emptyObjective } from '@/utils/projectCharter'
import ProjectFieldHelp from '@/components/project/ProjectFieldHelp.vue'

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
  <div class="space-y-8">
    <section v-if="showObjectives" class="space-y-3" data-testid="charter-field-objectives">
      <div class="flex items-center gap-1">
        <h2 class="text-base font-semibold text-highlighted">{{ t('projects.charter.fields.objectives') }}</h2>
        <ProjectFieldHelp
          :label="helpLabel(t('projects.charter.fields.objectives'))"
          :text="t('projects.charter.help.objectives')"
        />
      </div>
      <div
        v-for="(row, index) in draft.objectives"
        :key="row.key"
        class="space-y-3 rounded-md border p-3"
        :data-testid="`charter-objective-${index}`"
      >
        <div class="grid gap-3 md:grid-cols-3">
          <div class="space-y-2">
            <div class="flex items-center gap-1">
              <label :for="`objective-goal-${row.key}`" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.objectiveGoal') }}</label>
              <ProjectFieldHelp
                :label="helpLabel(t('projects.charter.fields.objectiveGoal'))"
                :text="t('projects.charter.help.objectiveGoal')"
              />
            </div>
            <UInput
              :id="`objective-goal-${row.key}`"
              v-model="row.goal"
              class="w-full"
              :readonly="readonly"
              :disabled="disabled"
            />
          </div>
          <div class="space-y-2">
            <div class="flex items-center gap-1">
              <label :for="`objective-metric-${row.key}`" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.objectiveMetric') }}</label>
              <ProjectFieldHelp
                :label="helpLabel(t('projects.charter.fields.objectiveMetric'))"
                :text="t('projects.charter.help.objectiveMetric')"
              />
            </div>
            <UInput
              :id="`objective-metric-${row.key}`"
              v-model="row.metric"
              class="w-full"
              :readonly="readonly"
              :disabled="disabled"
            />
          </div>
          <div class="space-y-2">
            <div class="flex items-center gap-1">
              <label :for="`objective-target-${row.key}`" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.objectiveTarget') }}</label>
              <ProjectFieldHelp
                :label="helpLabel(t('projects.charter.fields.objectiveTarget'))"
                :text="t('projects.charter.help.objectiveTarget')"
              />
            </div>
            <UInput
              :id="`objective-target-${row.key}`"
              v-model="row.target"
              class="w-full"
              :readonly="readonly"
              :disabled="disabled"
            />
          </div>
        </div>
        <div v-if="!readonly" class="flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="ghost" size="sm" :disabled="disabled" :label="t('projects.charter.removeRow')" @click="requestRemove('objective', row)" />
        </div>
        <div
          v-if="pendingRemove?.kind === 'objective' && pendingRemove.key === row.key"
          class="space-y-2 rounded-md border border-error/40 bg-error/5 p-3 text-sm"
        >
          <p>{{ t('projects.charter.removeRowConfirm') }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton type="button" color="neutral" size="sm" :label="t('app.cancel')" @click="pendingRemove = null" variant="outline" />
            <UButton type="button" color="error" size="sm" :label="t('projects.charter.removeRow')" @click="removeRow('objective', row.key)" />
          </div>
        </div>
      </div>
      <UButton v-if="!readonly" type="button" color="neutral" size="sm" :disabled="disabled" :label="t('projects.charter.addObjective')" @click="addObjective" variant="outline" />
    </section>

    <section v-if="showDeliverables" class="space-y-3" data-testid="charter-field-deliverables">
      <div class="flex items-center gap-1">
        <h2 class="text-base font-semibold text-highlighted">{{ t('projects.charter.fields.deliverables') }}</h2>
        <ProjectFieldHelp
          :label="helpLabel(t('projects.charter.fields.deliverables'))"
          :text="t('projects.charter.help.deliverables')"
        />
      </div>
      <div
        v-for="(row, index) in draft.deliverables"
        :key="row.key"
        class="space-y-3 rounded-md border p-3"
        :data-testid="`charter-deliverable-${index}`"
      >
        <div class="space-y-2">
          <div class="flex items-center gap-1">
            <label :for="`deliverable-name-${row.key}`" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.deliverableName') }}</label>
            <ProjectFieldHelp
              :label="helpLabel(t('projects.charter.fields.deliverableName'))"
              :text="t('projects.charter.help.deliverableName')"
            />
          </div>
          <UInput
            :id="`deliverable-name-${row.key}`"
            v-model="row.name"
            class="w-full"
            :readonly="readonly"
            :disabled="disabled"
          />
        </div>
        <div class="space-y-2">
          <div class="flex items-center gap-1">
            <label :for="`deliverable-description-${row.key}`" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.deliverableDescription') }}</label>
            <ProjectFieldHelp
              :label="helpLabel(t('projects.charter.fields.deliverableDescription'))"
              :text="t('projects.charter.help.deliverableDescription')"
            />
          </div>
          <UTextarea
            :id="`deliverable-description-${row.key}`"
            v-model="row.description"
            class="w-full"
            :readonly="readonly"
            :disabled="disabled"
            :rows="2"
          />
        </div>
        <div class="space-y-2" data-testid="charter-field-acceptance">
          <div class="flex items-center gap-1">
            <label :for="`deliverable-acceptance-${row.key}`" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.acceptance') }}</label>
            <ProjectFieldHelp
              :label="helpLabel(t('projects.charter.fields.acceptance'))"
              :text="t('projects.charter.help.acceptance')"
            />
          </div>
          <UTextarea
            :id="`deliverable-acceptance-${row.key}`"
            v-model="row.acceptance"
            class="w-full"
            :readonly="readonly"
            :disabled="disabled"
            :rows="2"
          />
        </div>
        <div v-if="!readonly" class="flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="ghost" size="sm" :disabled="disabled" :label="t('projects.charter.removeRow')" @click="requestRemove('deliverable', row)" />
        </div>
        <div
          v-if="pendingRemove?.kind === 'deliverable' && pendingRemove.key === row.key"
          class="space-y-2 rounded-md border border-error/40 bg-error/5 p-3 text-sm"
        >
          <p>{{ t('projects.charter.removeRowConfirm') }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton type="button" color="neutral" size="sm" :label="t('app.cancel')" @click="pendingRemove = null" variant="outline" />
            <UButton type="button" color="error" size="sm" :label="t('projects.charter.removeRow')" @click="removeRow('deliverable', row.key)" />
          </div>
        </div>
      </div>
      <UButton v-if="!readonly" type="button" color="neutral" size="sm" :disabled="disabled" :label="t('projects.charter.addDeliverable')" @click="addDeliverable" variant="outline" />
    </section>
  </div>
</template>
