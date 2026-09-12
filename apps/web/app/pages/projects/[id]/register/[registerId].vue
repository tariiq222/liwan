<script setup lang="ts">
import { useProject } from '@/composables/useProjects'
import { useProjectRegisterItem } from '@/composables/useProjectGovernance'

const route = useRoute()
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
const hydrated = useHydrated()
</script>

<template>
  <SharedPageContainer v-if="route.path.replace(/\/+$/, '') === `/projects/${projectId}/register/${registerId}`" width="detail">
    <SharedPageHeader :title="item.data?.value?.title ?? t('projects.refresh.workspace.registerTitle')" :back-to="backTo" :back-label="t('projects.refresh.workspace.registerTitle')">
      <template #actions>
        <UButton v-if="item.data?.value && access.data.value?.can_manage && hydrated" data-testid="register-detail-edit" :to="`/projects/${projectId}/register/${registerId}/edit`">{{ t('app.edit') }}</UButton>
      </template>
    </SharedPageHeader>
    <SharedPageState
      :loading="item.isLoading.value"
      :error="item.error.value"
      :empty="!item.data.value"
      @retry="item.refetch"
    />
    <section v-if="item.data?.value" class="grid gap-4">
      <section class="nasq-ui-record-surface" aria-labelledby="register-summary-title">
        <div class="border-b border-default px-5 py-4"><h2 id="register-summary-title" class="text-lg font-semibold text-highlighted">{{ t('projects.refresh.workspace.registerSummary') }}</h2></div>
        <div class="p-5 space-y-4">
          <div class="flex flex-wrap gap-2 text-sm">
        <span>{{ t(`projects.governance.register.${item.data.value.kind}`) }}</span>
        <span>{{ t(`projects.governance.register.${item.data.value.priority}`) }}</span>
        <span>{{ t(`projects.governance.register.${item.data.value.status}`) }}</span>
        <span v-if="item.data.value.score !== null">{{ t('projects.governance.register.score') }}: {{ item.data.value.score }}</span>
          </div>
          <dl class="grid gap-4 sm:grid-cols-2">
        <div v-for="field in (['owner', 'dueDate', 'probability', 'impact'] as const)" :key="field">
          <dt class="text-sm text-muted">{{ t(`projects.governance.register.${field}`) }}</dt>
          <dd>{{ field === 'owner' ? item.data.value.owner?.name || '—' : field === 'dueDate' ? item.data.value.due_date || '—' : item.data.value[field] ?? '—' }}</dd>
        </div>
          </dl>
        </div>
      </section>
      <section class="nasq-ui-record-surface" aria-labelledby="register-description-title">
        <div class="border-b border-default px-5 py-4"><h2 id="register-description-title" class="text-lg font-semibold text-highlighted">{{ t('projects.refresh.workspace.registerDescription') }}</h2></div>
        <div class="p-5"><p class="whitespace-pre-wrap">{{ item.data.value.description || '—' }}</p></div>
      </section>
      <section class="nasq-ui-record-surface" aria-labelledby="register-plan-title">
        <div class="border-b border-default px-5 py-4"><h2 id="register-plan-title" class="text-lg font-semibold text-highlighted">{{ t('projects.refresh.workspace.registerPlan') }}</h2></div>
        <div class="p-5 space-y-2">
          <p class="whitespace-pre-wrap">{{ item.data.value.response || '—' }}</p>
          <p v-if="item.data.value.task">
          <span class="text-muted">{{ t('projects.governance.register.task') }}:</span>
          <NuxtLink class="underline" :to="{ path: `/projects/${projectId}/tasks/${item.data.value.task.id}` }">{{ item.data.value.task.name }}</NuxtLink>
          </p>
        </div>
      </section>
    </section>
  </SharedPageContainer>
  <NuxtPage />
</template>
