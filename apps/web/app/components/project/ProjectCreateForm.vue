<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProjectCreateDefaults } from '@/composables/useProjectSettings'
import ProjectCharterForm from '@/components/project/ProjectCharterForm.vue'

const emit = defineEmits<{ created: [id: number]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { me } = useMe()
const {
  data: defaults,
  isPending: defaultsLoading,
  isError: defaultsFailed,
  error: defaultsError,
  refetch: refetchDefaults,
  isFetching: defaultsFetching,
} = useProjectCreateDefaults()

const forbidden = computed(() => (
  defaultsError.value instanceof ApiError
  && (defaultsError.value.status === 403 || defaultsError.value.code === 'create_forbidden')
))
const defaultManagerName = computed(() => {
  const current = me.value
  return current && defaults.value?.default_manager_id === current.id ? current.name : null
})

async function retryDefaults() {
  await refetchDefaults()
}
</script>

<template>
  <div class="grid gap-4">
    <p class="text-sm text-muted-foreground">{{ t('projects.create.defaultsHint') }}</p>
    <p v-if="defaultsLoading && !defaults" data-testid="project-create-loading" class="text-sm text-muted-foreground">{{ t('projects.create.loading') }}</p>
    <div v-else-if="forbidden && !defaults" role="alert" class="grid gap-2" data-testid="project-create-forbidden">
      <p class="text-sm text-destructive">{{ t('projects.createForbidden') }}</p>
    </div>
    <div v-else-if="defaultsFailed && !defaults" role="alert" class="grid gap-2" data-testid="project-create-defaults-error">
      <p class="text-sm text-destructive">{{ t('projects.create.defaultsError') }}</p>
      <Button type="button" variant="outline" size="sm" :disabled="!hydrated || defaultsFetching" data-testid="project-create-retry" @click="retryDefaults">
        {{ t('projects.create.retry') }}
      </Button>
    </div>
    <ProjectCharterForm
      mode="create"
      :create-defaults="defaults"
      :default-manager-name="defaultManagerName"
      :disabled="!defaults || forbidden"
      @created="emit('created', $event)"
      @cancel="emit('cancel')"
    />
  </div>
</template>
