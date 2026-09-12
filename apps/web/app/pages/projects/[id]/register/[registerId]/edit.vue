<script setup lang="ts">
import RegisterForm from '@/components/project/governance/RegisterForm.vue'
import { useProject } from '@/composables/useProjects'
import { useProjectRegisterItem } from '@/composables/useProjectGovernance'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const registerId = computed(() => Number(route.params.registerId))
const item = useProjectRegisterItem(projectId, registerId)
// The owning section list is fixed by this page's own route, so the return trip
// is literal and carries only the state that list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: `/projects/${projectId.value}/register`, query: listQuery }
})
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
    <section v-if="item.data?.value && access.data.value?.can_manage" class="nasq-ui-record-surface">
      <div class="p-5">
        <RegisterForm :project-id="projectId" :item="item.data.value" @saved="() => router.push(backTo)" @cancel="router.push(backTo)" />
      </div>
    </section>
  </SharedPageContainer>
</template>
