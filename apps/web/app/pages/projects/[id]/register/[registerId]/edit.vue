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
// An edit form returns to the record it edits, not past it to the list: being
// thrown back to the list is exactly what the reader did not ask for. The
// target is fixed by this page's own route and carries the list state through,
// so the record's own back control still lands on a filtered list. A referrer's
// returnTo is dropped rather than forwarded: on the destination URL it would
// nest one level deeper on every round trip and redirect that page's controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: `/projects/${projectId.value}/register/${registerId.value}`, query: listQuery }
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
    <section v-if="item.data?.value && access.data.value?.can_manage" class="rounded-lg ring ring-default bg-default overflow-hidden">
      <div class="p-5">
        <RegisterForm :project-id="projectId" :item="item.data.value" @saved="() => router.push(backTo)" @cancel="router.push(backTo)" />
      </div>
    </section>
  </SharedPageContainer>
</template>
