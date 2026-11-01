<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import ChangeForm from '@/components/pmo/projects/changes/ChangeForm.vue'
import { useProjectChanges } from '@/composables/useProjectChanges'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const sourcePaths = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/changes`])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const access = useProjectChanges(projectId)
function created(item: { id: number }) {
  void router.replace({ path: `/projects/${projectId.value}/changes/${item.id}`, query: { returnTo: router.resolve(backTo.value).fullPath } })
}
</script>

<template>
  <SharedCreatePanel :title="t('projects.changes.create')" :back-to="backTo">
    <SharedPageState
      :loading="access.isLoading.value"
      :error="access.error.value"
      :empty="!access.isLoading.value && !access.error.value && !access.data.value"
      @retry="access.refetch"
    />
    <SharedForbiddenState v-if="access.data.value && !access.data.value.can_create" :description="t('projects.changes.membersOnly')" />
    <ChangeForm v-if="access.data.value?.can_create" :project-id="projectId" @saved="created" @cancel="router.push(backTo)" />
  </SharedCreatePanel>
</template>
