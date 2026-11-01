<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import ChangeForm from '@/components/pmo/projects/changes/ChangeForm.vue'
import { useProjectChange } from '@/composables/useProjectChanges'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const changeId = computed(() => Number(route.params.changeId))
const item = useProjectChange(projectId, changeId)
const sourcePaths = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/changes`])
const backTo = computed(() => recordParentTo(`/projects/${projectId.value}/changes/${changeId.value}`, route.query, sourcePaths.value, route.hash))
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.changes.edit')" :back-to="backTo" :back-label="t('projects.changes.title')" />
    <SharedPageState
      :loading="item.isLoading.value"
      :error="item.error.value"
      :empty="!item.isLoading.value && !item.data.value"
      @retry="item.refetch"
    />
    <SharedForbiddenState v-if="item.data.value && !item.data.value.can_edit" :description="t('projects.changes.readOnly')" />
    <ChangeForm v-if="item.data?.value?.can_edit" :project-id="projectId" :item="item.data.value" @saved="() => router.push(backTo)" @cancel="router.push(backTo)" />
  </SharedPageContainer>
</template>
