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
    <SharedPageHeader :title="item.data?.value?.title ?? t('projects.governance.register.title')" :back-to="returnTo" :back-label="t('projects.governance.register.title')" />
    <SharedPageState
      :loading="item.isLoading.value"
      :error="item.error.value"
      :empty="!item.data.value"
      @retry="item.refetch"
    />
    <section v-if="item.data?.value" class="nasq-panel nasq-panel-body space-y-4">
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
      <p class="whitespace-pre-wrap">{{ item.data.value.description || '—' }}</p>
      <p v-if="item.data.value.task">{{ t('projects.governance.register.task') }}: {{ item.data.value.task.name }}</p>
      <p class="whitespace-pre-wrap">{{ item.data.value.response || '—' }}</p>
      <NuxtLink
        v-if="access.data.value?.can_manage && hydrated"
        :to="{ path: `/projects/${projectId}/register/${registerId}/edit`, query: { returnTo } }"
      >
        <Button>{{ t('app.edit') }}</Button>
      </NuxtLink>
    </section>
  </SharedPageContainer>
  <NuxtPage />
</template>
