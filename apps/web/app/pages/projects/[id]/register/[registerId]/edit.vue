<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import RegisterForm from '@/components/pmo/projects/governance/RegisterForm.vue'
import { useProject } from '@/composables/useProjects'
import { useProjectRegisterItem } from '@/composables/useProjectGovernance'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const registerId = computed(() => Number(route.params.registerId))
const item = useProjectRegisterItem(projectId, registerId)
const sourcePaths = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/register`])
const backTo = computed(() => recordParentTo(`/projects/${projectId.value}/register/${registerId.value}`, route.query, sourcePaths.value, route.hash))
const access = useProject(projectId)
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.governance.registerForm.edit')" :back-to="backTo" :back-label="t('projects.refresh.workspace.registerTitle')" />
    <SharedPageState
      :loading="item.isLoading.value || access.isLoading.value"
      :error="item.error.value || access.error.value"
      :empty="!item.isLoading.value && !access.isLoading.value && !item.data.value"
      @retry="() => { void item.refetch(); void access.refetch() }"
    />
    <p v-if="access.data.value && !access.data.value.can_manage" role="status">{{ t('projects.governance.readOnly') }}</p>
    <RegisterForm v-if="item.data?.value && access.data.value?.can_manage" :project-id="projectId" :item="item.data.value" @saved="() => router.push(backTo)" @cancel="router.push(backTo)" />
  </SharedPageContainer>
</template>
