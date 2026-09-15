<script setup lang="ts">
import StakeholderForm from '@/components/project/governance/StakeholderForm.vue'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
// The owning section list is fixed by this page's own route, so the return trip
// is literal and carries only the state that list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: `/projects/${projectId.value}/stakeholders`, query: listQuery }
})
const access = useProject(projectId)
</script>

<template>
  <SharedCreatePanel :title="t('projects.governance.stakeholder.createTitle')" :back-to="backTo">
    <SharedPageState
      :loading="access.isLoading.value"
      :error="access.error.value"
      :empty="!access.isLoading.value && !access.error.value && !access.data.value"
      @retry="access.refetch"
    />
    <p v-if="access.data.value && !access.data.value.can_manage" role="status">{{ t('projects.governance.readOnly') }}</p>
    <StakeholderForm v-if="access.data.value?.can_manage" :project-id="projectId" @saved="() => router.push(backTo)" @cancel="router.push(backTo)" />
  </SharedCreatePanel>
</template>
