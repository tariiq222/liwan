<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useProjectStakeholder } from '@/composables/useProjectGovernance'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const stakeholderId = computed(() => Number(route.params.stakeholderId))
const item = useProjectStakeholder(projectId, stakeholderId)
const listPaths = computed(() => [`/projects/${projectId.value}/stakeholders`])
const backTo = computed(() => owningListBack(route.query, listPaths.value, route.hash))
const editTo = computed(() => recordChildTo(`/projects/${projectId.value}/stakeholders/${stakeholderId.value}/edit`, route.query, listPaths.value, route.hash))
const notFound = computed(() => item.error.value instanceof ApiError && [403, 404].includes(item.error.value.status))
const access = useProject(projectId)
const hydrated = useHydrated()
const detailPath = computed(() => `/projects/${projectId.value}/stakeholders/${stakeholderId.value}`)
</script>

<template>
  <SharedRecordPage
    v-if="route.path.replace(/\/+$/, '') === detailPath"
    :title="item.data?.value?.name ?? t('projects.governance.stakeholder.title')"
    :back-to="backTo"
    :back-label="t('projects.governance.stakeholders')"
    :loading="item.isLoading.value"
    :error="notFound ? null : item.error.value"
    @retry="item.refetch"
  >
    <template v-if="item.data?.value && access.data.value?.can_manage && hydrated" #actions>
      <UButton data-testid="stakeholder-detail-edit" :to="editTo">{{ t('app.edit') }}</UButton>
    </template>
    <SharedEmptyState v-if="!item.data?.value" :title="notFound ? t('projects.notFound') : t('app.noResults')" />
    <SharedRecordSection v-else :title="t('projects.refresh.workspace.stakeholderContact')">
      <dl class="grid gap-4 text-sm">
        <div><dt class="text-muted">{{ t('projects.governance.stakeholder.contact') }}</dt><dd dir="ltr" class="text-start">{{ item.data.value.contact || '—' }}</dd></div>
        <div><dt class="text-muted">{{ t('projects.governance.stakeholder.notes') }}</dt><dd class="whitespace-pre-wrap">{{ item.data.value.notes || '—' }}</dd></div>
      </dl>
    </SharedRecordSection>
    <template v-if="item.data?.value" #aside>
      <SharedPropertiesPanel :title="t('projects.refresh.workspace.stakeholderIdentity')">
        <SharedPropertyRow :label="t('projects.governance.stakeholder.internalUser')" :value="item.data.value.user?.name || t('projects.governance.stakeholder.noInternalUser')" />
        <SharedPropertyRow :label="t('projects.governance.stakeholder.organization')" :value="item.data.value.organization" />
        <SharedPropertyRow :label="t('projects.governance.stakeholder.role')" :value="item.data.value.role" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage />
</template>
