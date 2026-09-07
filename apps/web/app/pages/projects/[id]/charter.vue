<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import ProjectCharterForm from '@/components/project/ProjectCharterForm.vue'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, '/projects/' + projectId.value, ['/projects']) : '/projects')
const readonly = computed(() => !(project.value?.can_manage ?? false))

function onSaved() {
  toast.success(t('projects.charter.saved'))
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader
      :title="t('projects.charter.title')"
      :description="project?.name"
      :back-to="returnTo"
      :back-label="t('projects.backToProject')"
    />
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
          <ProjectCharterForm
            mode="edit"
            :project="project"
            :readonly="readonly"
            @saved="onSaved"
            @cancel="router.push(returnTo)"
          />
        </CardContent>
      </Card>
    </template>
  </SharedPageContainer>
</template>
