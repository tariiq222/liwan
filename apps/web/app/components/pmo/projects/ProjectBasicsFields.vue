<script setup lang="ts">
import type { ProjectBasicsDraft } from '@/utils/projectBasics'
const draft = defineModel<ProjectBasicsDraft>({ required: true })
const props = defineProps<{ disabled?: boolean; requireManager?: boolean; requireEndDate?: boolean; managerName?: string | null }>()
const { t } = useI18n()
const hydrated = useHydrated()
const details = ref(false)
const removing = ref<number | null>(null)
const measurementRows = ref<number[]>([])
watch(() => draft.value.date_start, value => { if (value) details.value = true }, {immediate:true})
const locked = computed(() => !hydrated.value || props.disabled)
function addObjective() { draft.value.objectives.push({ goal: '', metric: '', target: '' }) }
</script>
<template>
  <div class="grid gap-(--liwan-gap-card)" data-testid="project-basics-fields">
    <UFormField :label="t('projects.charter.fields.name')" required>
      <UInput v-model="draft.name" class="w-full" :disabled="locked" required maxlength="255" data-testid="project-create-name" />
    </UFormField>
    <UFormField :label="t('projects.charter.fields.description')">
      <UTextarea v-model="draft.description" class="w-full" :disabled="locked" :rows="3" />
    </UFormField>
    <SharedFormSection :title="t('projects.basics.objectives')">
      <SharedSubCard v-for="(objective, index) in draft.objectives" :key="index">
        <div class="grid gap-(--liwan-gap-card)">
          <UFormField :label="t('projects.basics.goal')"><UTextarea v-model="objective.goal" class="w-full" :disabled="locked" :rows="2" :data-testid="`project-objective-${index}`" /></UFormField>
          <div v-if="measurementRows.includes(index) || objective.metric || objective.target" class="liwan-auto-grid gap-(--liwan-gap-card)">
            <UFormField :label="t('projects.basics.metric')"><UInput v-model="objective.metric" class="w-full" :disabled="locked" /></UFormField>
            <UFormField :label="t('projects.basics.target')"><UInput v-model="objective.target" class="w-full" :disabled="locked" /></UFormField>
          </div>
          <UButton v-else type="button" color="neutral" variant="link" :disabled="locked" :label="t('projects.basics.addMeasurement')" @click="measurementRows.push(index)" />
          <SharedInlineConfirm v-if="removing === index" :title="t('projects.basics.removeGoal')" :confirm-label="t('app.confirm')" @cancel="removing = null" @confirm="draft.objectives.splice(index, 1); removing = null" />
          <UButton v-else-if="draft.objectives.length > 1" type="button" color="neutral" variant="ghost" :disabled="locked" :label="t('projects.basics.removeGoal')" @click="removing = index" />
        </div>
      </SharedSubCard>
      <UButton type="button" color="neutral" variant="outline" :disabled="locked" :label="t('projects.basics.addGoal')" data-testid="project-add-objective" @click="addObjective" />
    </SharedFormSection>
    <UFormField :label="t('projects.basics.successCriteria')" :description="t('projects.basics.successHint')">
      <UTextarea v-model="draft.success_criteria" class="w-full" :disabled="locked" :rows="3" data-testid="project-success-criteria" />
    </UFormField>
    <UButton type="button" color="neutral" variant="link" :disabled="locked" :aria-expanded="details" :label="t('projects.basics.details')" @click="details = !details" />
    <UFormField v-if="details || requireManager && !draft.user_id" :label="t('projects.charter.fields.manager')" :required="requireManager">
      <SharedPersonPicker :model-value="draft.user_id" value-key="user_id" :known="draft.user_id && managerName ? [{id: draft.user_id, name: managerName}] : []" :disabled="locked" :aria-label="t('projects.charter.fields.manager')" :aria-required="requireManager" data-testid="project-create-manager" @resolve="people => draft.user_id = people[0]?.id ?? null" />
    </UFormField>
    <UFormField v-if="details" :label="t('projects.charter.fields.date_start')">
      <SharedDateField v-model="draft.date_start" :disabled="locked" :aria-label="t('projects.charter.fields.date_start')" data-testid="project-create-start-date" />
    </UFormField>
    <UFormField v-if="details || requireEndDate" :label="t('projects.charter.fields.date_end')" :required="requireEndDate">
      <SharedDateField v-model="draft.date_end" :disabled="locked" :aria-label="t('projects.charter.fields.date_end')" :aria-required="requireEndDate" data-testid="project-create-end-date" />
    </UFormField>
  </div>
</template>
