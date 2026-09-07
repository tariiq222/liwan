<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import ProjectCharterForm from '@/components/project/ProjectCharterForm.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const readonly = computed(() => route.query.edit !== '1' || !(project.value?.can_manage ?? false))

function onSaved() {
  toast.success(t('projects.charter.saved'))
}

function onCancel() {
  if (projectId.value) router.push(`/projects/${projectId.value}/charter`)
}
</script>

<template>
  <SharedPageContainer width="form">
    <template v-if="projectId === null">
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
    </template>
    <template v-else-if="isLoading && !project">
      <p role="status" class="text-muted-foreground">{{ t('projects.loading') }}</p>
    </template>
    <template v-else-if="notFound">
      <p class="text-muted-foreground">{{ t('projects.notFound') }}</p>
    </template>
    <template v-else-if="error || !project">
      <p role="alert" class="text-destructive">{{ t('projects.loadError') }}</p>
    </template>
    <template v-else>
      <Card class="nasq-panel">
        <CardContent class="pt-6">
          <h2 class="mb-4 text-base font-semibold">{{ t('projects.charter.title') }}</h2>
          <ProjectCharterForm
            mode="edit"
            :project="project"
            :readonly="readonly"
            @saved="onSaved"
            @cancel="onCancel"
          />
        </CardContent>
      </Card>
    </template>
  </SharedPageContainer>
</template>
