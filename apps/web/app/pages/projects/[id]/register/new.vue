<script setup lang="ts">
import RegisterForm from '@/components/project/governance/RegisterForm.vue'
import { useProject } from '@/composables/useProjects'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/projects/${projectId.value}/register`, ['/projects']))
const access = useProject(projectId)
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.governance.registerForm.create')" :back-to="returnTo" :back-label="t('projects.refresh.workspace.registerTitle')" />
    <SharedPageState
      :loading="access.isLoading.value"
      :error="access.error.value"
      :empty="!access.isLoading.value && !access.error.value && !access.data.value"
      @retry="access.refetch"
    />
    <p v-if="access.data.value && !access.data.value.can_manage" role="status">{{ t('projects.governance.readOnly') }}</p>
    <section v-if="access.data.value?.can_manage" class="nasq-panel overflow-hidden">
      <div class="nasq-panel-body">
        <RegisterForm :project-id="projectId" @saved="() => router.push(returnTo)" @cancel="router.push(returnTo)" />
      </div>
    </section>
  </SharedPageContainer>
</template>
