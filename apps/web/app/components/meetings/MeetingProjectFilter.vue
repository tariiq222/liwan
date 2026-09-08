<script setup lang="ts">
import { useProjects } from '@/composables/useProjects'

const props = defineProps<{
  modelValue?: number
  disabled?: boolean
  id?: string
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

watch(selectedLabel, value => emit('resolved-name', value), { immediate: true })

function selectProject(value: unknown) {
  const raw = String(value)
  emit('update:modelValue', raw === 'all' ? undefined : Number(raw))
}
</script>

<template>
  <div v-if="canReadProjects" class="grid min-w-44 gap-1">
    <Label v-if="id" :for="id" class="sr-only">{{ t('meetingsFilters.project') }}</Label>
    <Input v-model="projectSearch" :disabled="!hydrated || disabled" :placeholder="t('meetingsFilters.projectSearch')" :aria-label="t('meetingsFilters.projectSearch')" class="h-9" />
    <Select :model-value="modelValue ? String(modelValue) : 'all'" :disabled="!hydrated || disabled || projectQuery.isLoading.value" @update:model-value="selectProject">
      <SelectTrigger :id="id" class="h-9 w-full" :aria-label="t('meetingsFilters.project')"><SelectValue :placeholder="t('meetingsFilters.allProjects')" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{{ t('meetingsFilters.allProjects') }}</SelectItem>
        <SelectItem v-for="project in options" :key="project.id" :value="String(project.id)">{{ project.name }}</SelectItem>
      </SelectContent>
    </Select>
    <p v-if="projectQuery.isLoading.value" class="text-xs text-muted-foreground" role="status">{{ t('meetingsFilters.projectsLoading') }}</p>
    <div v-else-if="projectQuery.error.value" class="flex items-center gap-2 text-xs text-destructive" role="alert">
      <span>{{ t('meetingsFilters.projectsError') }}</span>
      <Button type="button" variant="outline" size="sm" :disabled="!hydrated || disabled" @click="projectQuery.refetch()">{{ t('meetingsFilters.retry') }}</Button>
    </div>
    <p v-else-if="!options.length" class="text-xs text-muted-foreground">{{ t('meetingsFilters.noProjects') }}</p>
  </div>
</template>
