<script setup lang="ts">
import type { ProjectDetail, ProjectToolKey, ProjectToolPreferencesPatch } from '@liwan/contracts'
import { useProject, useUpdateProject } from '@/composables/useProjects'
import { optionalProjectTools } from '@/utils/projectTools'
import { saveErrorMessage } from '@/utils/formFeedback'
const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const optional = computed(() => optionalProjectTools(props.project.tools))
const preferences = ref<ProjectToolPreferencesPatch>({})
const baseline = ref<ProjectToolPreferencesPatch>({})
const writeToken = ref(props.project.updated_at)
const error = ref('')
const conflict = ref(false)
const { mutateAsync: update, isPending } = useUpdateProject()
const { refetch } = useProject(computed(() => props.project.id))
const dirty = computed(() => JSON.stringify(preferences.value) !== JSON.stringify(baseline.value))
function adopt(project: ProjectDetail) {
  preferences.value = Object.fromEntries(optionalProjectTools(project.tools).map(key => [key, project.tools[key].enabled]))
  baseline.value = { ...preferences.value }
  writeToken.value = project.updated_at
  error.value = ''
  conflict.value = false
}
function reset() { adopt(props.project) }
async function reload() {
  const result = await refetch()
  if (result.data) adopt(result.data)
}
watch(() => props.project, project => {
  if (!dirty.value) adopt(project)
  else if (project.updated_at !== writeToken.value) {
    conflict.value = true
    error.value = t('projects.tools.policyChanged')
  }
}, {immediate:true})
async function save() {
  if (!hydrated.value || isPending.value || conflict.value || !props.project.active || !props.project.can_manage) return
  const changed = (Object.keys(preferences.value) as ProjectToolKey[]).filter(key => preferences.value[key] !== baseline.value[key])
  if (!changed.length) return
  if (changed.some(key => props.project.tools[key].policy !== 'optional' || !props.project.tools[key].can_toggle)) {
    error.value = t('projects.tools.policyChanged')
    conflict.value = true
    await refetch()
    return
  }
  const patch = Object.fromEntries(changed.map(key => [key, preferences.value[key]]))
  try {
    const saved = await update({id:props.project.id,patch:{tool_preferences:patch,expected_updated_at:writeToken.value}})
    adopt(saved)
  } catch (failure) {
    error.value = `${t('projects.tools.policyChanged')} ${saveErrorMessage(failure,t('errors.generic'),t('errors.saveUncertain'))}`
    conflict.value = true
    await refetch()
  }
}
</script>
<template>
  <SharedSettingsCard v-if="optional.length" id="project-tools" :title="t('projects.tools.title')" :description="t('projects.tools.hint')" :dirty="dirty" :saving="isPending" :conflict="conflict" :message="error" :can-edit="project.can_manage && project.active" data-testid="project-tools-card" @save="save" @revert="reset" @reload="reload">
    <UFormField v-for="key in optional" :key="key" orientation="horizontal" :label="t(`projects.tools.${key}`)">
      <USwitch v-model="preferences[key]" :disabled="!hydrated || isPending || conflict || !project.active || !project.can_manage || !project.tools[key].can_toggle" :aria-label="t(`projects.tools.${key}`)" :data-testid="`project-tool-${key}`" />
    </UFormField>
  </SharedSettingsCard>
  <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
  <p v-if="dirty && !optional.length" role="alert" class="text-sm text-muted">{{ t('projects.tools.policyChanged') }}</p>
</template>
