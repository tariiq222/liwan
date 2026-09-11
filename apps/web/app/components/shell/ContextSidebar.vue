<script setup lang="ts">
import { PanelLeftClose, PanelLeftOpen } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import ConversationList from '@/components/chat/ConversationList.vue'
import SidebarCreateAction from '@/components/shell/SidebarCreateAction.vue'
import { useContextSidebar, useShellNavigation } from '@/composables/useShellNavigation'
import { activeShellModule, contextModuleFor, hidePinnedNewProject, shellContextGroups, shellModules } from '@/composables/useNav'
import { workspaceBreadcrumbs } from '@/utils/workspaceBreadcrumbs'
import { parseChatListRoute, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'
import { meetingCreateRoute } from '@/utils/meetingRoutes'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const { t, localeProperties } = useI18n()
const { me } = useMe()
const route = useRoute()
const router = useRouter()
const { module, projectId, project, contextLinks, breadcrumbLinks } = useShellNavigation(() => me.value)
const { expanded, hydrated, toggle } = useContextSidebar()
const navigationId = `context-navigation-${useId()}`
const activeModule = computed(() => activeShellModule(route.path))
// `home` and `projects` share one projects sidebar with one heading and one motion key (2026-09-11).
const linksModule = computed(() => contextModuleFor(activeModule.value))
const isProjectsArea = computed(() => linksModule.value === 'projects')
const moduleDefinition = computed(() => shellModules.find(item => item.id === linksModule.value) ?? module.value)
const contextTitle = computed(() => moduleDefinition.value ? t(moduleDefinition.value.labelKey) : t('app.productName'))
const isProject = computed(() => !!projectId.value && activeModule.value === 'projects')
const { remember } = useProjectWorkspaceMemory()
watch([() => route.fullPath, () => project.data.value, () => me.value, hydrated], () => {
  if (isProject.value && project.data.value?.id === projectId.value && !project.error.value) remember(route.path, route.query)
}, { immediate: true })
const isChat = computed(() => activeModule.value === 'chat')
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const routeState = computed(() => parseChatListRoute(route.query))
const selectedConversationId = computed(() => {
  const match = route.path.match(/^\/chat\/(\d+)(?:\/|$)/)
  const id = Number(match?.[1])
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
})
const primaryLinks = computed(() => contextLinks.value)
const breadcrumbs = computed(() => workspaceBreadcrumbs(route.path, route.query, breadcrumbLinks.value, project.data.value?.name))
const moduleLinks = computed(() => (isChat.value && isDesktop.value && expanded.value
  ? primaryLinks.value.filter(item => item.id === 'new-chat')
  : primaryLinks.value))
// One shared grouping for the desktop sidebar and the mobile menu.
const contextGroups = computed(() => linksModule.value ? shellContextGroups(linksModule.value, me.value, route.path, moduleLinks.value) : [])
const createLinks = computed(() => {
  if (isChat.value && isDesktop.value) return []
  return contextGroups.value.flatMap(group => group.links).filter(link => link.pinned && !(link.id === 'new-project' && hidePinnedNewProject(route.path)))
})
const navigationGroups = computed(() => contextGroups.value
  .map(group => ({ ...group, links: group.links.filter(link => !link.pinned) }))
  .filter(group => group.links.length))
const showContextNav = computed(() => {
  const links = navigationGroups.value.flatMap(group => group.links)
  if (!createLinks.value.length && links.length === 1 && links[0]!.labelKey === moduleDefinition.value?.labelKey) return false
  return links.length > 0
})
const contextMotionKey = computed(() => `module:${linksModule.value ?? 'none'}`)

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
  if (link.id === 'new-meeting') return meetingCreateRoute(listReturnTo(link.id), typeof route.query.project_id === 'string' ? route.query.project_id : undefined, typeof route.query.series_id === 'string' ? route.query.series_id : undefined)
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
    :data-project-module="isProjectsArea || route.path.startsWith('/settings/projects')"
    :data-chat="isChat"
    :data-expanded="expanded"
    :data-direction="localeProperties.dir"
    :aria-label="t('nav.context')"
  >
    <UTooltip :text="t(expanded ? 'nav.collapseContext' : 'nav.expandContext')">
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        class="nasq-context-toggle"
        data-testid="context-sidebar-toggle"
        :disabled="!hydrated"
        :aria-expanded="expanded"
        :aria-controls="navigationId"
        :aria-label="t(expanded ? 'nav.collapseContext' : 'nav.expandContext')"
        :title="t(expanded ? 'nav.collapseContext' : 'nav.expandContext')"
        @click="toggle"
      >
        <template #leading>
          <PanelLeftClose v-if="expanded" aria-hidden="true" />
          <PanelLeftOpen v-else aria-hidden="true" />
        </template>
        <span>{{ t(expanded ? 'nav.collapseContext' : 'nav.expandContext') }}</span>
      </UButton>
    </UTooltip>
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

      <nav v-if="showContextNav" class="nasq-context-links" :data-grouped="activeModule === 'settings' || isProjectsArea" :aria-label="contextTitle">
        <div v-for="group in navigationGroups" :key="group.id" class="nasq-context-group">
          <h3 v-if="group.labelKey" class="nasq-context-group-heading">{{ t(group.labelKey) }}</h3>
          <div class="nasq-context-group-links">
            <UTooltip v-for="link in group.links" :key="link.id" :text="t(link.labelKey)">
              <UButton
                :to="href(link)"
                color="neutral"
                variant="ghost"
                class="nasq-context-link"
                :data-active="link.active"
                :active="!!link.active"
                :aria-current="link.active ? 'page' : undefined"
                :aria-label="t(link.labelKey)"
                :title="t(link.labelKey)"
                :data-testid="link.id === 'appearance' ? 'sidebar-settings' : link.id === 'project-settings' ? 'settings-projects-tab' : link.id === 'branding' ? 'settings-branding-tab' : `context-link-${link.id}`"
              >
                <template #leading>
                  <component :is="link.icon" aria-hidden="true" />
                </template>
                <span>{{ t(link.labelKey) }}</span>
              </UButton>
            </UTooltip>
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
