<script setup lang="ts">
import { PanelLeftClose, PanelLeftOpen } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import ConversationList from '@/components/chat/ConversationList.vue'
import SidebarCreateAction from '@/components/shell/SidebarCreateAction.vue'
import { useContextSidebar, useShellNavigation } from '@/composables/useShellNavigation'
import { activeShellModule, contextGroupsForModule, shellModules } from '@/composables/useNav'
import { projectBreadcrumbs } from '@/utils/projectBreadcrumbs'
import { parseChatListRoute, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const { t, localeProperties } = useI18n()
const { me } = useMe()
const route = useRoute()
const router = useRouter()
const { module, projectId, project, contextLinks } = useShellNavigation(() => me.value)
const { expanded, hydrated, toggle } = useContextSidebar()
const navigationId = `context-navigation-${useId()}`
const activeModule = computed(() => activeShellModule(route.path))
const moduleDefinition = computed(() => shellModules.find(item => item.id === activeModule.value) ?? module.value)
const contextTitle = computed(() => isProject.value ? project.data.value?.name ?? t('nav.currentProject') : moduleDefinition.value ? t(moduleDefinition.value.labelKey) : t('app.productName'))
const isProject = computed(() => !!projectId.value && activeModule.value === 'projects')
const { remember } = useProjectWorkspaceMemory()
watch([() => route.fullPath, () => project.data.value, () => me.value, hydrated], () => {
  if (isProject.value && project.data.value?.id === projectId.value && !project.error.value) remember(route.path, route.query)
}, { immediate: true })
const isChat = computed(() => activeModule.value === 'chat')
const isDesktop = useMediaQuery('(min-width: 761px)', { ssrWidth: 1024 })
const routeState = computed(() => parseChatListRoute(route.query))
const selectedConversationId = computed(() => {
  const match = route.path.match(/^\/chat\/(\d+)(?:\/|$)/)
  const id = Number(match?.[1])
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
})
// Group module navigation, current project sections, and system settings.
const primaryLinks = computed(() => contextLinks.value)
const breadcrumbs = computed(() => projectBreadcrumbs(route.path, route.query, contextLinks.value, project.data.value?.name))
const moduleLinks = computed(() => {
  const links = isChat.value && isDesktop.value && expanded.value
    ? primaryLinks.value.filter(item => item.id === 'new-chat')
    : primaryLinks.value
  if (activeModule.value === 'projects') return links
  return [...links.filter(item => item.pinned), ...links.filter(item => !item.pinned)]
})
const contextGroups = computed(() => {
  if (isProject.value) {
    return [
      { id: 'project-work', labelKey: 'nav.projectWork', links: moduleLinks.value.filter(link => ['tasks', 'milestones'].includes(link.id)) },
      { id: 'project-followup', labelKey: 'nav.projectFollowup', links: moduleLinks.value.filter(link => !['tasks', 'milestones', 'current-project-settings'].includes(link.id)) },
      { id: 'project-settings', links: moduleLinks.value.filter(link => link.id === 'current-project-settings') },
    ].filter(group => group.links.length)
  }
  if (activeModule.value === 'projects') {
    const overviewIds = ['new-project', 'project-dashboard', 'projects', 'my-projects']
    return [
      { id: 'projects-overview', labelKey: 'nav.projectsOverview', links: moduleLinks.value.filter(link => overviewIds.includes(link.id)) },
      { id: 'current-project', labelKey: 'nav.currentProject', links: moduleLinks.value.filter(link => !overviewIds.includes(link.id) && link.id !== 'project-system-settings') },
      { id: 'project-system', labelKey: 'nav.projectSystem', links: moduleLinks.value.filter(link => link.id === 'project-system-settings') },
    ].filter(group => group.links.length)
  }
  if (activeModule.value === 'settings') {
    return contextGroupsForModule('settings', me.value, route.path)
      .map(group => ({ ...group, links: group.links.map(link => moduleLinks.value.find(item => item.id === link.id)).filter((link): link is NonNullable<typeof link> => Boolean(link)) }))
      .filter(group => group.links.length)
  }
  return moduleLinks.value.length ? [{ id: 'default' as const, links: moduleLinks.value }] : []
})
const createLinks = computed(() => contextGroups.value.flatMap(group => group.links).filter(link => link.pinned && !(link.id === 'new-project' && ['/projects', '/projects/new'].includes(route.path))))
const navigationGroups = computed(() => contextGroups.value
  .map(group => ({ ...group, links: group.links.filter(link => !link.pinned) }))
  .filter(group => group.links.length))
const showContextNav = computed(() => {
  const links = navigationGroups.value.flatMap(group => group.links)
  if (!createLinks.value.length && links.length === 1 && links[0]!.labelKey === moduleDefinition.value?.labelKey) return false
  return links.length > 0
})
const contextMotionKey = computed(() => {
  const moduleKey = activeModule.value ?? 'none'
  return `module:${moduleKey}`
})

function href(link: { to: import('vue-router').RouteLocationRaw }) {
  return link.to
}

function listReturnTo(linkId: string): string {
  const path = route.path.replace(/\/+$/, '') || '/'
  const fullPath = route.fullPath
  if (linkId === 'new-project') {
    return path === '/projects' || path === '/projects/dashboard'
      ? fullPath
      : safeReturnTo(route.query.returnTo, '/projects', ['/projects'])
  }
  if (linkId === 'new-task') {
    return path === '/tasks' || path === '/archived-tasks'
      ? fullPath
      : safeReturnTo(route.query.returnTo, '/tasks', ['/tasks', '/archived-tasks', '/projects'])
  }
  if (linkId === 'new-meeting') {
    return path === '/meetings' || path === '/meetings/calendar' || path === '/meetings/series'
      ? fullPath
      : safeReturnTo(route.query.returnTo, '/meetings', ['/meetings'])
  }
  if (linkId === 'new-employee' || linkId === 'new-department' || linkId === 'new-document') {
    const isHrList = linkId === 'new-employee'
      ? path === '/hr'
      : linkId === 'new-department'
        ? path === '/hr/departments'
        : path === '/hr/documents' || /^\/hr\/departments\/[^/]+\/documents$/.test(path)
    if (isHrList) return fullPath
    const fallback = linkId === 'new-department' ? '/hr/departments' : linkId === 'new-document' ? '/hr/documents' : '/hr'
    return safeReturnTo(route.query.returnTo, fallback, ['/hr'])
  }
  return fullPath
}

function createTo(link: { id: string; to: import('vue-router').RouteLocationRaw }): import('vue-router').RouteLocationRaw {
  if (link.id === 'new-chat') return { path: '/chat/new', query: serializeChatListRoute(parseChatListRoute(route.query)) }
  const target = typeof link.to === 'string' ? link.to : link.to.path
  if (!target) return link.to
  const query: Record<string, string> = returnToQuery(listReturnTo(link.id))
  if (link.id === 'new-document') {
    const departmentId = typeof route.query.department_id === 'string'
      ? route.query.department_id
      : typeof route.params.departmentId === 'string' ? route.params.departmentId : undefined
    if (departmentId) query.department_id = departmentId
  }
  return { path: target, query }
}

function updateRoute(next: ChatListRoute) {
  void router.replace({ path: route.path, query: serializeChatListRoute(next) })
}
</script>

<template>
  <aside
    data-testid="context-sidebar"
    class="nasq-context-sidebar"
    :data-project="isProject"
    :data-project-module="activeModule === 'projects' || route.path.startsWith('/settings/projects')"
    :data-chat="isChat"
    :data-expanded="expanded"
    :data-direction="localeProperties.dir"
    :aria-label="t('nav.context')"
  >
    <button
      type="button"
      class="nasq-context-toggle"
      data-testid="context-sidebar-toggle"
      :disabled="!hydrated"
      :aria-expanded="expanded"
      :aria-controls="navigationId"
      :aria-label="t(expanded ? 'nav.collapseContext' : 'nav.expandContext')"
      :title="t(expanded ? 'nav.collapseContext' : 'nav.expandContext')"
      @click="toggle"
    >
      <PanelLeftClose v-if="expanded" aria-hidden="true" />
      <PanelLeftOpen v-else aria-hidden="true" />
      <span>{{ t(expanded ? 'nav.collapseContext' : 'nav.expandContext') }}</span>
    </button>
    <Transition name="nasq-context" mode="out-in">
      <div :id="navigationId" :key="contextMotionKey" class="nasq-context-sidebar-inner">
      <div class="nasq-context-heading">
        <span class="nasq-context-emblem" aria-hidden="true">
          <component :is="moduleDefinition?.icon ?? shellModules[0]!.icon" />
        </span>
        <div class="nasq-context-heading-copy">
          <h2>{{ contextTitle }}</h2>
      <nav v-if="breadcrumbs.length && expanded" class="nasq-project-breadcrumb" :aria-label="t('nav.breadcrumb')" data-testid="project-sidebar-breadcrumb">
        <ol class="flex flex-wrap items-center gap-x-1 gap-y-1">
          <template v-for="(crumb, index) in breadcrumbs" :key="crumb.key">
            <li v-if="index" aria-hidden="true">/</li>
            <li>
              <NuxtLink v-if="crumb.to" :to="crumb.to" :aria-current="index === breadcrumbs.length - 1 ? 'page' : undefined" aria-current-value="false">{{ crumb.label ?? t(crumb.labelKey!) }}</NuxtLink>
              <span v-else :aria-current="index === breadcrumbs.length - 1 ? 'page' : undefined">{{ crumb.label ?? t(crumb.labelKey!) }}</span>
            </li>
          </template>
        </ol>
      </nav>
        </div>
      </div>

      <div v-if="createLinks.length" class="nasq-context-create-actions">
        <SidebarCreateAction
          v-for="link in createLinks"
          :key="link.id"
          :to="createTo(link)"
          :label="t(link.labelKey)"
          :active="link.active"
          :test-id="`context-link-${link.id}`"
        />
      </div>

      <nav v-if="showContextNav" class="nasq-context-links" :data-grouped="activeModule === 'settings' || activeModule === 'projects'" :aria-label="contextTitle">
        <div v-for="group in navigationGroups" :key="group.id" class="nasq-context-group" :class="{ 'mt-4 border-t border-border pt-3': group.id === 'project-settings' }">
          <h3 v-if="group.labelKey" class="nasq-context-group-heading">{{ t(group.labelKey) }}</h3>
          <div class="nasq-context-group-links">
            <NuxtLink
              v-for="link in group.links"
              :key="link.id"
              :to="href(link)"
              class="nasq-context-link"
              :data-active="link.active"
              :aria-current="link.active ? 'page' : undefined"
              :aria-label="t(link.labelKey)"
              :title="t(link.labelKey)"
              :data-testid="link.id === 'appearance' ? 'sidebar-settings' : link.id === 'project-settings' ? 'settings-projects-tab' : link.id === 'branding' ? 'settings-branding-tab' : `context-link-${link.id}`"
            >
              <component :is="link.icon" aria-hidden="true" />
              <span>{{ t(link.labelKey) }}</span>
            </NuxtLink>
          </div>
        </div>
      </nav>

      <ConversationList
        v-if="isChat && isDesktop"
        v-show="expanded"
        class="min-h-0 flex-1"
        :route-state="routeState"
        :selected-id="selectedConversationId"
        @update:route-state="updateRoute"
      />

      </div>
    </Transition>
  </aside>
</template>
