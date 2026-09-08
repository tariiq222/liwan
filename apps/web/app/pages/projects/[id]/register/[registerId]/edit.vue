<script setup lang="ts">
import RegisterForm from '@/components/project/governance/RegisterForm.vue'
import { useProject } from '@/composables/useProjects'
import { useProjectRegisterItem } from '@/composables/useProjectGovernance'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const registerId = computed(() => Number(route.params.registerId))
const item = useProjectRegisterItem(projectId, registerId)
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/projects/${projectId.value}/register/${registerId.value}`, ['/projects']))
const access = useProject(projectId)
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.governance.registerForm.edit')" :back-to="returnTo" :back-label="t('projects.refresh.workspace.registerTitle')" />
    <SharedPageState
      :loading="item.isLoading.value || access.isLoading.value"
      :error="item.error.value || access.error.value"
      :empty="!item.isLoading.value && !access.isLoading.value && !item.data.value"
      @retry="() => { void item.refetch(); void access.refetch() }"
    />
    <p v-if="access.data.value && !access.data.value.can_manage" role="status">{{ t('projects.governance.readOnly') }}</p>
    <section v-if="item.data?.value && access.data.value?.can_manage" class="nasq-panel nasq-panel-body">
      <RegisterForm :project-id="projectId" :item="item.data.value" @saved="() => router.push(returnTo)" @cancel="router.push(returnTo)" />
    </section>
  </SharedPageContainer>
</template>
