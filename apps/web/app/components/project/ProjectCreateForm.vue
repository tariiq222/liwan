<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProjectCreateDefaults } from '@/composables/useProjectSettings'
import ProjectCharterForm from '@/components/project/ProjectCharterForm.vue'
import { returnToQuery } from '@/utils/safeReturnTo'
import type { CharterWizardStep } from '@/utils/charterSteps'

const emit = defineEmits<{ created: [id: number]; drafted: [id: number, step: CharterWizardStep]; cancel: [] }>()
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

// The server decides the default manager (a tenant setting), so the hint only claims "you" when it is you.
const defaultsHint = computed(() => {
  const base = t('projects.create.defaultsHintBase')
  const managerId = defaults.value?.default_manager_id
  if (!managerId) return base
  const who = me.value && managerId === me.value.id ? t('projects.create.defaultManagerSelf') : t('projects.create.defaultManagerOther')
  return `${who} ${base}`
})

async function retryDefaults() {
  await refetchDefaults()
}
</script>

<template>
  <SharedFormSection :title="t('projects.charter.title')" :description="defaultsHint">
    <div class="grid gap-4">
      <NuxtLink
        :to="{ path: '/projects/templates', query: returnToQuery(route.fullPath) }"
        data-testid="project-create-from-template"
        class="inline-flex w-fit items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <UIcon name="i-lucide-layout-template" class="size-4" aria-hidden="true" />
        {{ t('projects.create.fromTemplate') }}
      </NuxtLink>
      <p v-if="defaultsLoading && !defaults" data-testid="project-create-loading" class="text-sm text-muted">{{ t('projects.create.loading') }}</p>
      <div v-else-if="forbidden && !defaults" role="alert" class="grid gap-2" data-testid="project-create-forbidden">
        <p class="text-sm text-error">{{ t('projects.createForbidden') }}</p>
      </div>
      <div v-else-if="defaultsFailed && !defaults" role="alert" class="grid gap-2" data-testid="project-create-defaults-error">
        <p class="text-sm text-error">{{ t('projects.create.defaultsError') }}</p>
        <UButton type="button" color="neutral" size="sm" :disabled="!hydrated || defaultsFetching" data-testid="project-create-retry" :label="t('projects.create.retry')" @click="retryDefaults" variant="outline" />
      </div>
      <ProjectCharterForm
        mode="create"
        :create-defaults="defaults"
        :default-manager-name="defaultManagerName"
        :disabled="!defaults || forbidden"
        @created="emit('created', $event)"
        @drafted="(id, step) => emit('drafted', id, step)"
        @cancel="emit('cancel')"
      />
    </div>
  </SharedFormSection>
</template>
