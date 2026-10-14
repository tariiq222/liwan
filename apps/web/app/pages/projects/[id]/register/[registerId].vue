<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { REGISTER_PRIORITY_TONE, REGISTER_STATUS_TONE } from '@/components/project/governance/state'
import { useProject } from '@/composables/useProjects'
import { useProjectRegisterItem } from '@/composables/useProjectGovernance'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const registerId = computed(() => Number(route.params.registerId))
const item = useProjectRegisterItem(projectId, registerId)
const listPaths = computed(() => [`/projects/${projectId.value}/register`])
const backTo = computed(() => owningListBack(route.query, listPaths.value, route.hash))
const editTo = computed(() => recordChildTo(`/projects/${projectId.value}/register/${registerId.value}/edit`, route.query, listPaths.value, route.hash))
const access = useProject(projectId)
const hydrated = useHydrated()
const detailPath = computed(() => `/projects/${projectId.value}/register/${registerId.value}`)
</script>

<template>
  <SharedRecordPage
    v-if="route.path.replace(/\/+$/, '') === detailPath"
    :title="item.data?.value?.title ?? t('projects.refresh.workspace.registerTitle')"
    :back-to="backTo"
    :back-label="t('projects.refresh.workspace.registerTitle')"
    :loading="item.isLoading.value"
    :error="item.error.value"
    @retry="item.refetch"
  >
    <template v-if="item.data?.value && access.data.value?.can_manage && hydrated" #actions>
      <UButton data-testid="register-detail-edit" :to="editTo">{{ t('app.edit') }}</UButton>
    </template>
    <SharedEmptyState v-if="!item.data?.value" :title="t('app.noResults')" />
    <template v-else>
      <SharedRecordSection :title="t('projects.refresh.workspace.registerDescription')">
        <p class="whitespace-pre-wrap text-sm">{{ item.data.value.description || '—' }}</p>
      </SharedRecordSection>
      <SharedRecordSection :title="t('projects.refresh.workspace.registerPlan')">
        <p class="whitespace-pre-wrap text-sm">{{ item.data.value.response || '—' }}</p>
        <p v-if="item.data.value.task" class="text-sm">
          <span class="text-muted">{{ t('projects.governance.register.task') }}:</span>
          <NuxtLink class="underline" :to="{ path: `/projects/${projectId}/tasks/${item.data.value.task.id}` }">{{ item.data.value.task.name }}</NuxtLink>
        </p>
      </SharedRecordSection>
    </template>
    <template v-if="item.data?.value" #aside>
      <SharedPropertiesPanel :title="t('projects.refresh.workspace.registerSummary')">
        <SharedPropertyRow :label="t('projects.governance.register.kind')" :value="t(`projects.governance.register.${item.data.value.kind}`)" />
        <SharedPropertyRow :label="t('projects.governance.register.priority')"><SharedStatusBadge :tone="REGISTER_PRIORITY_TONE[item.data.value.priority]" :label="t(`projects.governance.register.${item.data.value.priority}`)" /></SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.governance.register.status')"><SharedStatusBadge :tone="REGISTER_STATUS_TONE[item.data.value.status]" :label="t(`projects.governance.register.${item.data.value.status}`)" /></SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.governance.register.score')" :value="item.data.value.score" />
        <SharedPropertyRow :label="t('projects.governance.register.owner')" :value="item.data.value.owner?.name" />
        <SharedPropertyRow :label="t('projects.governance.register.dueDate')" :value="item.data.value.due_date" />
        <SharedPropertyRow :label="t('projects.governance.register.probability')" :value="item.data.value.probability" />
        <SharedPropertyRow :label="t('projects.governance.register.impact')" :value="item.data.value.impact" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage />
</template>
