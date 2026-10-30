<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { REGISTER_PRIORITY_TONE, REGISTER_STATUS_TONE, registerScoreTone } from '@/components/pmo/projects/governance/state'
import { formatCalendarDate } from '@webvue/ui/app/composables/calendarDate'
import { useProject } from '@/composables/useProjects'
import { useProjectRegisterItem } from '@/composables/useProjectGovernance'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const registerId = computed(() => Number(route.params.registerId))
const item = useProjectRegisterItem(projectId, registerId)
const listPaths = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/register`])
const backTo = computed(() => owningListBack(route.query, listPaths.value, route.hash))
const editTo = computed(() => recordChildTo(`/projects/${projectId.value}/register/${registerId.value}/edit`, route.query, listPaths.value, route.hash))
const access = useProject(projectId)
const hydrated = useHydrated()
const detailPath = computed(() => `/projects/${projectId.value}/register/${registerId.value}`)
</script>

<template>
  <SharedRecordPage :keep-content="!!item.data.value"
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
      <SharedRecordSection variant="panel" :title="t('projects.refresh.workspace.registerDescription')">
        <p class="whitespace-pre-wrap text-sm">{{ item.data.value.description || '—' }}</p>
      </SharedRecordSection>
      <SharedRecordSection variant="panel" :title="t('projects.refresh.workspace.registerPlan')">
        <div class="grid gap-(--webvue-gap-card)">
          <p class="whitespace-pre-wrap text-sm">{{ item.data.value.response || '—' }}</p>
          <SharedSubCard v-if="item.data.value.task" tone="tinted" class="text-sm">
            <span class="text-muted">{{ t('projects.governance.register.task') }}:</span>
            <NuxtLink class="font-medium text-primary hover:underline" :to="{ path: `/projects/${projectId}/tasks/${item.data.value.task.id}` }">{{ item.data.value.task.name }}</NuxtLink>
          </SharedSubCard>
        </div>
      </SharedRecordSection>
    </template>
    <template v-if="item.data?.value" #summary>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('projects.governance.register.kind')">
          <SharedStatusBadge tone="neutral" :icon="item.data.value.kind === 'risk' ? 'i-lucide-triangle-alert' : 'i-lucide-circle-alert'" :label="t(`projects.governance.register.${item.data.value.kind}`)" />
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.governance.register.priority')"><SharedStatusBadge :tone="REGISTER_PRIORITY_TONE[item.data.value.priority]" :label="t(`projects.governance.register.${item.data.value.priority}`)" /></SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.governance.register.status')"><SharedStatusBadge :tone="REGISTER_STATUS_TONE[item.data.value.status]" :label="t(`projects.governance.register.${item.data.value.status}`)" /></SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.governance.register.score')">
          <SharedStatusBadge v-if="item.data.value.score != null" :tone="registerScoreTone(item.data.value.score)" :label="String(item.data.value.score)" />
          <span v-else aria-hidden="true">—</span>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.governance.register.owner')">
          <span v-if="item.data.value.owner" class="inline-flex items-center gap-2"><SharedPersonAvatar :people="[item.data.value.owner]" />{{ item.data.value.owner.name }}</span>
          <span v-else aria-hidden="true">—</span>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.governance.register.dueDate')" :value="formatCalendarDate(item.data.value.due_date) || null" />
        <SharedPropertyRow :label="t('projects.governance.register.probability')" :value="item.data.value.probability" />
        <SharedPropertyRow :label="t('projects.governance.register.impact')" :value="item.data.value.impact" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage />
</template>
