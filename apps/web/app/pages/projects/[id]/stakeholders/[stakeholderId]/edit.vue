<script setup lang="ts">
import StakeholderForm from '@/components/project/governance/StakeholderForm.vue'
import { useProject } from '@/composables/useProjects'
import { useProjectStakeholder } from '@/composables/useProjectGovernance'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const stakeholderId = computed(() => Number(route.params.stakeholderId))
const item = useProjectStakeholder(projectId, stakeholderId)
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/projects/${projectId.value}/stakeholders/${stakeholderId.value}`, ['/projects']))
const access = useProject(projectId)
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.governance.stakeholder.editTitle')" :back-to="returnTo" :back-label="t('projects.governance.stakeholder.title')" />
    <SharedPageState
      :loading="item.isLoading.value || access.isLoading.value"
      :error="item.error.value || access.error.value"
      :empty="!item.isLoading.value && !access.isLoading.value && !item.data.value"
      @retry="() => { void item.refetch(); void access.refetch() }"
    />
    <p v-if="access.data.value && !access.data.value.can_manage" role="status">{{ t('projects.governance.readOnly') }}</p>
    <section v-if="item.data?.value && access.data.value?.can_manage" class="nasq-panel nasq-panel-body">
      <StakeholderForm :project-id="projectId" :stakeholder="item.data.value" @saved="() => router.push(returnTo)" @cancel="router.push(returnTo)" />
    </section>
  </SharedPageContainer>
</template>
