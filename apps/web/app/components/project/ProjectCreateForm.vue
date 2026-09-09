<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProjectCreateDefaults } from '@/composables/useProjectSettings'
import ProjectCharterForm from '@/components/project/ProjectCharterForm.vue'
import { returnToQuery } from '@/utils/safeReturnTo'

const emit = defineEmits<{ created: [id: number]; cancel: [] }>()
const { t } = useI18n()
const route = useRoute()
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
  <SharedFormSection :title="t('projects.charter.title')" :description="t('projects.create.defaultsHint')">
    <div class="grid gap-4">
      <NuxtLink
        :to="{ path: '/project-templates', query: returnToQuery(route.fullPath) }"
        data-testid="project-create-from-template"
        class="w-fit text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {{ t('projects.create.fromTemplate') }}
      </NuxtLink>
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
  </SharedFormSection>
</template>
