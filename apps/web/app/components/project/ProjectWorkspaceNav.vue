<script setup lang="ts">
const props = defineProps<{ projectId: number; active?: boolean }>()
const route = useRoute()
const { t } = useI18n()

const projectActive = computed(() => props.active !== false)
const base = computed(() => `/projects/${props.projectId}`)
const rest = computed(() => route.path.replace(/\/+$/, '').replace(base.value, '').replace(/^\//, ''))
const current = computed(() => {
  if (!rest.value) {
    const tab = route.query.tab
    if (tab === 'tasks' || tab === 'list' || tab === 'board') return 'tasks'
    if (tab === 'milestones' || tab === 'updates') return tab
    return 'overview'
  }
  return rest.value.split('/')[0] ?? 'overview'
})

const items = computed(() => {
  const id = props.projectId
  const rows: { key: string; to: string; label: string; testid?: string }[] = [
    { key: 'overview', to: `/projects/${id}`, label: t('projects.tabs.overview') },
    { key: 'tasks', to: `/projects/${id}?tab=tasks`, label: t('projects.tabs.tasks') },
    { key: 'milestones', to: `/projects/${id}?tab=milestones`, label: t('projects.tabs.milestones') },
    { key: 'updates', to: `/projects/${id}?tab=updates`, label: t('projects.tabs.updates') },
    { key: 'charter', to: `/projects/${id}/charter`, label: t('projects.charter.open'), testid: 'project-charter-link' },
  ]
  if (projectActive.value) {
    rows.push(
      { key: 'schedule', to: `/projects/${id}/schedule`, label: t('projects.planningLinks.schedule'), testid: 'project-schedule-link' },
      { key: 'stakeholders', to: `/projects/${id}/stakeholders`, label: t('projects.planningLinks.stakeholders'), testid: 'project-stakeholders-link' },
      { key: 'raci', to: `/projects/${id}/raci`, label: t('projects.planningLinks.raci'), testid: 'project-raci-link' },
      { key: 'register', to: `/projects/${id}/register`, label: t('projects.planningLinks.register'), testid: 'project-register-link' },
    )
  }
  rows.push({ key: 'finance', to: `/projects/${id}/finance`, label: t('projects.finance.title'), testid: 'project-finance-link' })
  return rows
})
</script>

<template>
  <nav class="nasq-tabs" :aria-label="t('projects.title')">
    <NuxtLink
      v-for="item in items"
      :key="item.key"
      :to="item.to"
      :aria-current="current === item.key ? 'page' : undefined"
      :data-testid="item.testid"
    >
      {{ item.label }}
    </NuxtLink>
  </nav>
</template>
