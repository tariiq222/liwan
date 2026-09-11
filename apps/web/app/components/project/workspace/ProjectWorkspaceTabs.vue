<script setup lang="ts">
import { projectWorkspaceGroups } from '@/composables/useNav'
import { useProject } from '@/composables/useProjects'

const props = defineProps<{
  projectId: number
  active?: boolean
  canManage?: boolean
}>()

const route = useRoute()
const { t } = useI18n()
const { me } = useMe()
const hydrated = useHydrated()
const projectId = computed(() => Number.isInteger(props.projectId) && props.projectId > 0 ? props.projectId : null)
const projectQuery = useProject(projectId)
// Server and first client render must produce the same tab set.
const projectData = computed(() => hydrated.value ? projectQuery.data.value : undefined)
const activeProject = computed(() => props.active ?? projectData.value?.active ?? true)
const canManage = computed(() => props.canManage ?? projectData.value?.can_manage ?? false)
const isProjectRoot = computed(() => /^\/projects\/\d+\/?$/.test(route.path))
const model = computed(() => projectWorkspaceGroups(props.projectId, me.value, activeProject.value, canManage.value, route.query, isProjectRoot.value, route.path))
const activeGroup = computed(() => model.value.groups.find(group => group.id === model.value.activeGroup) ?? null)
</script>

<template>
  <div v-if="model.groups.length" class="flex flex-col gap-3">
    <!-- Group tabs: underline strip, the horizontal counterpart of the sidebar's brand bar. -->
    <nav
      class="nasq-ui-tab-strip"
      data-testid="project-workspace-tabs"
      :aria-label="t('projects.workspace.tabsLabel')"
    >
      <UButton
        v-for="group in model.groups"
        :key="group.id"
        color="neutral"
        variant="ghost"
        class="nasq-ui-tab"
        :to="group.to"
        :aria-current="model.activeGroup === group.id ? 'page' : undefined"
        :data-active="model.activeGroup === group.id"
        :data-testid="`project-tab-${group.id}`"
      >
        <component :is="group.icon" aria-hidden="true" class="size-4" />
        <span>{{ t(group.labelKey) }}</span>
      </UButton>
    </nav>
    <!-- Sub-sections: quiet pills; the active one uses the shared secondary recipe. -->
    <nav
      v-if="activeGroup?.links.length"
      class="nasq-ui-subtab-row"
      data-testid="project-workspace-subtabs"
      :aria-label="t('projects.workspace.subtabsLabel')"
    >
      <UButton
        v-for="link in activeGroup.links"
        :key="link.id"
        size="sm"
        :color="model.activeTab === link.id ? 'secondary' : 'neutral'"
        :variant="model.activeTab === link.id ? 'solid' : 'ghost'"
        :to="link.to"
        :aria-current="model.activeTab === link.id ? 'page' : undefined"
        :data-active="model.activeTab === link.id"
        :data-testid="`project-subtab-${link.id}`"
      >
        <component :is="link.icon" aria-hidden="true" class="size-4" />
        <span>{{ t(link.labelKey) }}</span>
      </UButton>
    </nav>
  </div>
</template>
