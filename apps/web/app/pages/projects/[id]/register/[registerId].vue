<script setup lang="ts">
import { useProject } from '@/composables/useProjects'
import { useProjectRegisterItem } from '@/composables/useProjectGovernance'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const registerId = computed(() => Number(route.params.registerId))
const item = useProjectRegisterItem(projectId, registerId)
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/projects/${projectId.value}/register`, ['/projects']))
const access = useProject(projectId)
const hydrated = useHydrated()
</script>

<template>
  <SharedPageContainer v-if="route.path.replace(/\/+$/, '') === `/projects/${projectId}/register/${registerId}`" width="detail">
    <SharedPageHeader :title="item.data?.value?.title ?? t('projects.refresh.workspace.registerTitle')" :back-to="returnTo" :back-label="t('projects.refresh.workspace.registerTitle')">
      <template #actions>
        <NuxtLink v-if="item.data?.value && access.data.value?.can_manage && hydrated" :to="{ path: `/projects/${projectId}/register/${registerId}/edit`, query: { returnTo } }">
          <Button data-testid="register-detail-edit">{{ t('app.edit') }}</Button>
        </NuxtLink>
      </template>
    </SharedPageHeader>
    <SharedPageState
      :loading="item.isLoading.value"
      :error="item.error.value"
      :empty="!item.data.value"
      @retry="item.refetch"
    />
    <section v-if="item.data?.value" class="grid gap-4">
      <section class="nasq-panel overflow-hidden" aria-labelledby="register-summary-title">
        <div class="nasq-panel-header"><h2 id="register-summary-title">{{ t('projects.refresh.workspace.registerSummary') }}</h2></div>
        <div class="nasq-panel-body space-y-4">
          <div class="flex flex-wrap gap-2 text-sm">
        <span>{{ t(`projects.governance.register.${item.data.value.kind}`) }}</span>
        <span>{{ t(`projects.governance.register.${item.data.value.priority}`) }}</span>
        <span>{{ t(`projects.governance.register.${item.data.value.status}`) }}</span>
        <span v-if="item.data.value.score !== null">{{ t('projects.governance.register.score') }}: {{ item.data.value.score }}</span>
          </div>
          <dl class="grid gap-4 sm:grid-cols-2">
        <div v-for="field in (['owner', 'dueDate', 'probability', 'impact'] as const)" :key="field">
          <dt class="text-sm text-muted-foreground">{{ t(`projects.governance.register.${field}`) }}</dt>
          <dd>{{ field === 'owner' ? item.data.value.owner?.name || '—' : field === 'dueDate' ? item.data.value.due_date || '—' : item.data.value[field] ?? '—' }}</dd>
        </div>
          </dl>
        </div>
      </section>
      <section class="nasq-panel overflow-hidden" aria-labelledby="register-description-title">
        <div class="nasq-panel-header"><h2 id="register-description-title">{{ t('projects.refresh.workspace.registerDescription') }}</h2></div>
        <div class="nasq-panel-body"><p class="whitespace-pre-wrap">{{ item.data.value.description || '—' }}</p></div>
      </section>
      <section class="nasq-panel overflow-hidden" aria-labelledby="register-plan-title">
        <div class="nasq-panel-header"><h2 id="register-plan-title">{{ t('projects.refresh.workspace.registerPlan') }}</h2></div>
        <div class="nasq-panel-body space-y-2">
          <p class="whitespace-pre-wrap">{{ item.data.value.response || '—' }}</p>
          <p v-if="item.data.value.task">
          <span class="text-muted-foreground">{{ t('projects.governance.register.task') }}:</span>
          <NuxtLink class="underline" :to="{ path: `/projects/${projectId}/tasks/${item.data.value.task.id}`, query: { returnTo: route.fullPath } }">{{ item.data.value.task.name }}</NuxtLink>
          </p>
        </div>
      </section>
    </section>
  </SharedPageContainer>
  <NuxtPage />
</template>
