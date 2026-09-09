<script setup lang="ts">
import type { ProjectWorkspaceTabId } from '@/composables/useNav'
import { projectContextId, projectWorkspaceLinks } from '@/composables/useNav'
import { useProject } from '@/composables/useProjects'

const props = defineProps<{
  projectId: number
  active?: boolean
  canManage?: boolean
}>()

const route = useRoute()
const { t } = useI18n()
const { me } = useMe()
const projectId = computed(() => Number.isInteger(props.projectId) && props.projectId > 0 ? props.projectId : null)
const projectQuery = useProject(projectId)
const activeProject = computed(() => props.active ?? projectQuery.data.value?.active ?? true)
const canManage = computed(() => props.canManage ?? projectQuery.data.value?.can_manage ?? false)
const isProjectRoot = computed(() => /^\/projects\/\d+\/?$/.test(route.path))
const links = computed(() => projectWorkspaceLinks(props.projectId, me.value, activeProject.value, canManage.value, route.query, isProjectRoot.value))

function currentTab(path: string, query: Record<string, unknown>): ProjectWorkspaceTabId {
  const section = projectContextId(path, query)
  if (section === 'planning') {
    return query.tab === 'milestones' ? 'milestones' : 'tasks'
  }
  if (section === 'stakeholders') return 'stakeholders'
  if (section === 'risks') return 'risks'
  if (section === 'finance') return 'finance'
  if (section === 'charter') return 'charter'
  if (section === 'settings') return 'settings'
  return 'summary'
}

const activeTab = computed(() => {
  const candidate = currentTab(route.path, route.query)
  return links.value.some(link => link.id === candidate) ? candidate : 'summary'
})
</script>

<template>
  <nav
    v-if="links.length"
    class="nasq-tabs"
    data-testid="project-workspace-tabs"
    :aria-label="t('projects.workspace.tabsLabel')"
  >
    <NuxtLink
      v-for="link in links"
      :key="link.id"
      :to="link.to"
      :aria-current="activeTab === link.id ? 'page' : undefined"
      :data-active="activeTab === link.id"
      :data-testid="`project-tab-${link.id}`"
    >
      <component :is="link.icon" aria-hidden="true" class="size-4" />
      <span>{{ t(link.labelKey) }}</span>
    </NuxtLink>
  </nav>
</template>
