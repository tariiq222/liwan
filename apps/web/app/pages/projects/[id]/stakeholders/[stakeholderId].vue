<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useProjectStakeholder } from '@/composables/useProjectGovernance'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const stakeholderId = computed(() => Number(route.params.stakeholderId))
const item = useProjectStakeholder(projectId, stakeholderId)
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/projects/${projectId.value}/stakeholders`, ['/projects']))
const notFound = computed(() => item.error.value instanceof ApiError && [403, 404].includes(item.error.value.status))
const access = useProject(projectId)
const hydrated = useHydrated()
</script>

<template>
  <SharedPageContainer v-if="route.path.replace(/\/+$/, '') === `/projects/${projectId}/stakeholders/${stakeholderId}`" width="detail">
    <SharedPageHeader :title="item.data?.value?.name ?? t('projects.governance.stakeholder.title')" :back-to="returnTo" :back-label="t('projects.governance.stakeholders')">
      <template #actions>
        <UButton v-if="item.data?.value && access.data.value?.can_manage && hydrated" data-testid="stakeholder-detail-edit" :to="{ path: `/projects/${projectId}/stakeholders/${stakeholderId}/edit`, query: { returnTo } }">{{ t('app.edit') }}</UButton>
      </template>
    </SharedPageHeader>
    <SharedPageState
      :loading="item.isLoading.value"
      :error="notFound ? null : item.error.value"
      :empty="notFound || !item.data.value"
      :empty-text="notFound ? t('projects.notFound') : t('app.noResults')"
      @retry="item.refetch"
    />
    <section v-if="item.data?.value" class="grid gap-4">
      <section class="rounded-xl border border-default bg-default overflow-hidden" aria-labelledby="stakeholder-identity-title">
        <div class="border-b border-default px-5 py-4"><h2 id="stakeholder-identity-title" class="text-lg font-semibold text-highlighted">{{ t('projects.refresh.workspace.stakeholderIdentity') }}</h2></div>
        <div class="p-5">
          <dl class="grid gap-4 sm:grid-cols-2">
          <div>
          <dt class="text-sm text-muted">{{ t('projects.governance.stakeholder.internalUser') }}</dt>
          <dd>{{ item.data.value.user?.name || t('projects.governance.stakeholder.noInternalUser') }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted">{{ t('projects.governance.stakeholder.organization') }}</dt>
          <dd>{{ item.data.value.organization || '—' }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted">{{ t('projects.governance.stakeholder.role') }}</dt>
          <dd>{{ item.data.value.role || '—' }}</dd>
          </div>
          </dl>
        </div>
      </section>
      <section class="rounded-xl border border-default bg-default overflow-hidden" aria-labelledby="stakeholder-contact-title">
        <div class="border-b border-default px-5 py-4"><h2 id="stakeholder-contact-title" class="text-lg font-semibold text-highlighted">{{ t('projects.refresh.workspace.stakeholderContact') }}</h2></div>
        <div class="p-5">
          <dl>
            <div>
            <dt class="text-sm text-muted">{{ t('projects.governance.stakeholder.contact') }}</dt>
            <dd dir="ltr" class="text-start">{{ item.data.value.contact || '—' }}</dd>
            </div>
            <div class="mt-4">
            <dt class="text-sm text-muted">{{ t('projects.governance.stakeholder.notes') }}</dt>
            <dd class="whitespace-pre-wrap">{{ item.data.value.notes || '—' }}</dd>
            </div>
          </dl>
        </div>
      </section>
    </section>
  </SharedPageContainer>
  <NuxtPage />
</template>
