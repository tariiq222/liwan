<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import ProjectCharterForm from '@/components/project/ProjectCharterForm.vue'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const readonly = computed(() => route.query.edit !== '1' || !(project.value?.can_manage ?? false))
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, `/projects/${projectId.value}`, ['/projects']) : '/projects')

function onSaved() {
  toast.success(t('projects.charter.saved'))
}

function onCancel() {
  if (projectId.value) void router.push({ path: `/projects/${projectId.value}/charter`, query: { ...route.query, edit: undefined } })
}
</script>

<template>
  <SharedPageContainer :width="readonly ? 'detail' : 'form'">
    <SharedPageHeader
      :title="t('projects.charter.title')"
      :description="t('projects.charter.pageDescription')"
      :eyebrow="project?.name"
      :back-to="returnTo"
      :back-label="t('projects.backToProject')"
    >
      <template #actions>
        <Button v-if="project?.can_manage && readonly" :disabled="!hydrated" @click="router.push({ path: route.path, query: { ...route.query, edit: '1' } })">{{ t('app.edit') }}</Button>
      </template>
    </SharedPageHeader>
    <template v-if="projectId === null">
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="isLoading && !project"
      :error="notFound ? null : error"
      :empty="notFound || (!isLoading && !error && !project)"
      :empty-text="notFound ? t('projects.notFound') : t('projects.empty')"
      @retry="refetch"
    >
      <Card class="nasq-form">
        <CardContent class="pt-6">
          <ProjectCharterForm
            mode="edit"
            :project="project"
            :readonly="readonly"
            @saved="onSaved"
            @cancel="onCancel"
          />
        </CardContent>
      </Card>
    </SharedPageState>
  </SharedPageContainer>
</template>
