<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import StakeholderForm from '@/components/pmo/projects/governance/StakeholderForm.vue'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const sourcePaths = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/stakeholders`])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const access = useProject(projectId)
function created(item: { id: number }) {
  void router.replace({ path: `/projects/${projectId.value}/stakeholders/${item.id}`, query: { returnTo: router.resolve(backTo.value).fullPath } })
}
</script>

<template>
  <SharedCreatePanel :title="t('projects.governance.stakeholder.createTitle')" :back-to="backTo">
    <SharedPageState
      :loading="access.isLoading.value"
      :error="access.error.value"
      :empty="!access.isLoading.value && !access.error.value && !access.data.value"
      @retry="access.refetch"
    />
    <SharedForbiddenState v-if="access.data.value && !access.data.value.can_manage" :description="t('projects.governance.readOnly')" />
    <StakeholderForm v-if="access.data.value?.can_manage" :project-id="projectId" @saved="created" @cancel="router.push(backTo)" />
  </SharedCreatePanel>
</template>
