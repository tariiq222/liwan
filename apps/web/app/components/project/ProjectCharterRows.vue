<script setup lang="ts">
import type { CharterDraft, DeliverableDraft, ObjectiveDraft } from '@/utils/projectCharter'
import { emptyDeliverable, emptyObjective } from '@/utils/projectCharter'
import ProjectFieldHelp from '@/components/project/ProjectFieldHelp.vue'

const draft = defineModel<CharterDraft>({ required: true })
const props = defineProps<{
  readonly?: boolean
  disabled?: boolean
  compact?: boolean
}>()

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
    <section class="space-y-3" data-testid="charter-field-objectives">
      <div class="flex items-center gap-1">
        <h2 class="text-sm font-medium">{{ t('projects.charter.fields.objectives') }}</h2>
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
              <Label :for="`objective-goal-${row.key}`">{{ t('projects.charter.fields.objectiveGoal') }}</Label>
              <ProjectFieldHelp
                :label="helpLabel(t('projects.charter.fields.objectiveGoal'))"
                :text="t('projects.charter.help.objectiveGoal')"
              />
            </div>
            <Input
              :id="`objective-goal-${row.key}`"
              v-model="row.goal"
              :readonly="readonly"
              :disabled="disabled"
            />
          </div>
          <div class="space-y-2">
            <div class="flex items-center gap-1">
              <Label :for="`objective-metric-${row.key}`">{{ t('projects.charter.fields.objectiveMetric') }}</Label>
              <ProjectFieldHelp
                :label="helpLabel(t('projects.charter.fields.objectiveMetric'))"
                :text="t('projects.charter.help.objectiveMetric')"
              />
            </div>
            <Input
              :id="`objective-metric-${row.key}`"
              v-model="row.metric"
              :readonly="readonly"
              :disabled="disabled"
            />
          </div>
          <div class="space-y-2">
            <div class="flex items-center gap-1">
              <Label :for="`objective-target-${row.key}`">{{ t('projects.charter.fields.objectiveTarget') }}</Label>
              <ProjectFieldHelp
                :label="helpLabel(t('projects.charter.fields.objectiveTarget'))"
                :text="t('projects.charter.help.objectiveTarget')"
              />
            </div>
            <Input
              :id="`objective-target-${row.key}`"
              v-model="row.target"
              :readonly="readonly"
              :disabled="disabled"
            />
          </div>
        </div>
        <div v-if="!readonly" class="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" :disabled="disabled" @click="requestRemove('objective', row)">
            {{ t('projects.charter.removeRow') }}
          </Button>
        </div>
        <div
          v-if="pendingRemove?.kind === 'objective' && pendingRemove.key === row.key"
          class="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <p>{{ t('projects.charter.removeRowConfirm') }}</p>
          <div class="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" @click="pendingRemove = null">{{ t('app.cancel') }}</Button>
            <Button type="button" variant="destructive" size="sm" @click="removeRow('objective', row.key)">{{ t('projects.charter.removeRow') }}</Button>
          </div>
        </div>
      </div>
      <Button v-if="!readonly" type="button" variant="outline" size="sm" :disabled="disabled" @click="addObjective">
        {{ t('projects.charter.addObjective') }}
      </Button>
    </section>

    <section v-if="!compact" class="space-y-3" data-testid="charter-field-deliverables">
      <div class="flex items-center gap-1">
        <h2 class="text-sm font-medium">{{ t('projects.charter.fields.deliverables') }}</h2>
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
            <Label :for="`deliverable-name-${row.key}`">{{ t('projects.charter.fields.deliverableName') }}</Label>
            <ProjectFieldHelp
              :label="helpLabel(t('projects.charter.fields.deliverableName'))"
              :text="t('projects.charter.help.deliverableName')"
            />
          </div>
          <Input
            :id="`deliverable-name-${row.key}`"
            v-model="row.name"
            :readonly="readonly"
            :disabled="disabled"
          />
        </div>
        <div class="space-y-2">
          <div class="flex items-center gap-1">
            <Label :for="`deliverable-description-${row.key}`">{{ t('projects.charter.fields.deliverableDescription') }}</Label>
            <ProjectFieldHelp
              :label="helpLabel(t('projects.charter.fields.deliverableDescription'))"
              :text="t('projects.charter.help.deliverableDescription')"
            />
          </div>
          <Textarea
            :id="`deliverable-description-${row.key}`"
            v-model="row.description"
            :readonly="readonly"
            :disabled="disabled"
            rows="2"
          />
        </div>
        <div class="space-y-2" data-testid="charter-field-acceptance">
          <div class="flex items-center gap-1">
            <Label :for="`deliverable-acceptance-${row.key}`">{{ t('projects.charter.fields.acceptance') }}</Label>
            <ProjectFieldHelp
              :label="helpLabel(t('projects.charter.fields.acceptance'))"
              :text="t('projects.charter.help.acceptance')"
            />
          </div>
          <Textarea
            :id="`deliverable-acceptance-${row.key}`"
            v-model="row.acceptance"
            :readonly="readonly"
            :disabled="disabled"
            rows="2"
          />
        </div>
        <div v-if="!readonly" class="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" :disabled="disabled" @click="requestRemove('deliverable', row)">
            {{ t('projects.charter.removeRow') }}
          </Button>
        </div>
        <div
          v-if="pendingRemove?.kind === 'deliverable' && pendingRemove.key === row.key"
          class="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <p>{{ t('projects.charter.removeRowConfirm') }}</p>
          <div class="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" @click="pendingRemove = null">{{ t('app.cancel') }}</Button>
            <Button type="button" variant="destructive" size="sm" @click="removeRow('deliverable', row.key)">{{ t('projects.charter.removeRow') }}</Button>
          </div>
        </div>
      </div>
      <Button v-if="!readonly" type="button" variant="outline" size="sm" :disabled="disabled" @click="addDeliverable">
        {{ t('projects.charter.addDeliverable') }}
      </Button>
    </section>
  </div>
</template>
