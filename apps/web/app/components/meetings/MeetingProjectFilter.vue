<script setup lang="ts">
import { useProjects } from '@/composables/useProjects'

const props = defineProps<{
  modelValue?: number
  disabled?: boolean
  id?: string
  hideLabel?: boolean
  label?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: number | undefined]
  'resolved-name': [value: string]
}>()

const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const canReadProjects = computed(() => can('pmo.projects.read'))
const projectQuery = useProjects(canReadProjects)
const projectSearch = ref('')

const selectedProject = computed(() => (projectQuery.data.value ?? []).find(project => project.id === props.modelValue))
const selectedLabel = computed(() => selectedProject.value?.name ?? (props.modelValue ? t('meetingsFilters.selectedProject') : ''))
const options = computed(() => {
  const search = projectSearch.value.trim().toLocaleLowerCase()
  const available = (projectQuery.data.value ?? []).filter(project => !search || project.name.toLocaleLowerCase().includes(search))
  if (!props.modelValue || available.some(project => project.id === props.modelValue)) return available
  return selectedProject.value ? [selectedProject.value, ...available] : [{ id: props.modelValue, name: selectedLabel.value }, ...available]
})
const items = computed(() => [{ label: t('meetingsFilters.allProjects'), value: 'all' }, ...options.value.map(project => ({ label: project.name, value: String(project.id) }))])

watch(selectedLabel, value => emit('resolved-name', value), { immediate: true })

function selectProject(value: unknown) {
  const raw = String(value)
  emit('update:modelValue', raw === 'all' ? undefined : Number(raw))
}
</script>

<template>
  <div v-if="canReadProjects" class="grid min-w-44 gap-1">
    <label v-if="id && !hideLabel" :for="id" class="text-sm font-medium text-highlighted">{{ label || t('meetingsFilters.project') }}</label>
    <USelectMenu
      :id="id"
      v-model:search-term="projectSearch"
      :model-value="modelValue ? String(modelValue) : 'all'"
      :items="items"
      :ignore-filter="true"
      value-key="value"
      class="w-full"
      :disabled="!hydrated || disabled || projectQuery.isLoading.value"
      :placeholder="t('meetingsFilters.allProjects')"
      :search-input="{ placeholder: t('meetingsFilters.projectSearch') }"
      :aria-label="t('meetingsFilters.project')"
      @update:model-value="selectProject"
    />
    <p v-if="projectQuery.isLoading.value" class="text-xs text-muted" role="status">{{ t('meetingsFilters.projectsLoading') }}</p>
    <div v-else-if="projectQuery.error.value" class="flex items-center gap-2 text-xs text-error" role="alert">
      <span>{{ t('meetingsFilters.projectsError') }}</span>
      <UButton type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated || disabled" :label="t('meetingsFilters.retry')" @click="projectQuery.refetch()" />
    </div>
    <p v-else-if="!options.length" class="text-xs text-muted">{{ t('meetingsFilters.noProjects') }}</p>
  </div>
</template>
