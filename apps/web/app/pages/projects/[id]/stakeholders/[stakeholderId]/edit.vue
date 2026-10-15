<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import StakeholderForm from '@/components/pmo/projects/governance/StakeholderForm.vue'
import { useProject } from '@/composables/useProjects'
import { useProjectStakeholder } from '@/composables/useProjectGovernance'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const stakeholderId = computed(() => Number(route.params.stakeholderId))
const item = useProjectStakeholder(projectId, stakeholderId)
const backTo = computed(() => recordParentTo(`/projects/${projectId.value}/stakeholders/${stakeholderId.value}`, route.query, [`/projects/${projectId.value}/stakeholders`], route.hash))
const access = useProject(projectId)
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.governance.stakeholder.editTitle')" :back-to="backTo" :back-label="t('projects.governance.stakeholder.title')" />
    <SharedPageState
      :loading="item.isLoading.value || access.isLoading.value"
      :error="item.error.value || access.error.value"
      :empty="!item.isLoading.value && !access.isLoading.value && !item.data.value"
      @retry="() => { void item.refetch(); void access.refetch() }"
    />
    <p v-if="access.data.value && !access.data.value.can_manage" role="status">{{ t('projects.governance.readOnly') }}</p>
    <SharedFormSection v-if="item.data?.value && access.data.value?.can_manage" panel>
        <StakeholderForm :project-id="projectId" :stakeholder="item.data.value" @saved="() => router.push(backTo)" @cancel="router.push(backTo)" />
      </SharedFormSection>
  </SharedPageContainer>
</template>
