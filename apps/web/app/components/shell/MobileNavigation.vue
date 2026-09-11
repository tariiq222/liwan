<script setup lang="ts">
import type { SlideoverProps } from '@nuxt/ui'
import { Menu } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import SidebarCreateAction from '@/components/shell/SidebarCreateAction.vue'
import { useShellNavigation } from '@/composables/useShellNavigation'
import { activeShellModule, contextGroupsForModule, shellModules, visibleShellModules } from '@/composables/useNav'
import { parseChatListRoute, serializeChatListRoute } from '@/utils/chatState'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const { t, te, localeProperties } = useI18n()
const menuTitle = computed(() => te('nav.navigation') ? t('nav.navigation') : t('nav.modules'))
const openMenuLabel = computed(() => te('nav.openMenu') ? t('nav.openMenu') : t('nav.toggleSidebar'))
const { me } = useMe()
const route = useRoute()
const router = useRouter()
const hydrated = useHydrated()
const open = ref(false)
const desktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const { module, projectId, project, contextLinks } = useShellNavigation(() => me.value)
const availableModules = computed(() => visibleShellModules(me.value))
const activeModule = computed(() => activeShellModule(route.path))
const moduleDefinition = computed(() => shellModules.find(item => item.id === activeModule.value) ?? module.value)
const isProject = computed(() => !!projectId.value && activeModule.value === 'projects')
const contextTitle = computed(() => isProject.value ? project.data.value?.name ?? t('nav.currentProject') : moduleDefinition.value ? t(moduleDefinition.value.labelKey) : t('app.productName'))
const primaryLinks = computed(() => contextLinks.value)
const moduleLinks = computed(() => {
  if (activeModule.value === 'projects') return primaryLinks.value
  return [...primaryLinks.value.filter(item => item.pinned), ...primaryLinks.value.filter(item => !item.pinned)]
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

watch(desktop, value => { if (value) open.value = false })
watch(() => route.fullPath, () => { open.value = false })

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

function closeIfCurrent(to: import('vue-router').RouteLocationRaw) {
  if (router.resolve(to).fullPath === route.fullPath) open.value = false
}

function moduleTarget(module: { id: string; to: string }) {
  return module.id === 'vendor' ? undefined : module.to
}

function onModuleActivate(module: { id: string; to: string }) {
  if (module.id === 'vendor' || router.resolve(module.to).fullPath === route.fullPath) open.value = false
}

const dialogContent = computed<NonNullable<SlideoverProps['content']> & { id: string }>(() => ({ id: 'mobile-navigation' }))
</script>

<template>
  <USlideover
    v-model:open="open"
    :side="localeProperties.dir === 'rtl' ? 'right' : 'left'"
    :title="menuTitle"
    :description="contextTitle"
    :content="dialogContent"
    :ui="{ content: 'nasq-mobile-menu', overlay: 'nasq-mobile-menu-overlay' }"
  >
    <UButton
      id="mobile-navigation-trigger"
      class="nasq-mobile-menu-trigger"
      type="button"
      color="neutral"
      variant="ghost"
      square
      data-testid="mobile-navigation-trigger"
      aria-controls="mobile-navigation"
      :aria-expanded="open"
      :aria-label="openMenuLabel"
      :disabled="!hydrated"
    >
      <template #leading>
        <Menu aria-hidden="true" />
      </template>
    </UButton>
    <template #body>
      <div>
        <nav :aria-label="t('nav.modules')" class="grid gap-2">
          <UButton
            v-for="item in availableModules"
            :key="item.id"
            :to="moduleTarget(item)"
            :href="item.id === 'vendor' ? item.to : undefined"
            :target="item.id === 'vendor' ? '_blank' : undefined"
            :rel="item.id === 'vendor' ? 'noopener' : undefined"
            color="neutral"
            variant="ghost"
            class="nasq-module-rail-link"
            :label="t(item.labelKey)"
            :aria-label="t(item.labelKey)"
            :aria-current="activeModule === item.id ? 'page' : undefined"
            :data-active="activeModule === item.id"
            :active="activeModule === item.id"
            @click="onModuleActivate(item)"
          >
            <template #leading>
              <component :is="item.icon" aria-hidden="true" />
            </template>
          </UButton>
        </nav>
        <USeparator class="my-6" />
        <h2 class="mb-3 font-semibold">{{ contextTitle }}</h2>
        <div v-if="createLinks.length" class="mb-3 grid gap-2">
          <SidebarCreateAction
            v-for="link in createLinks"
            :key="link.id"
            :to="createTo(link)"
            :label="t(link.labelKey)"
            :active="link.active"
            :test-id="`mobile-context-link-${link.id}`"
            @click="closeIfCurrent(createTo(link))"
          />
        </div>
        <nav v-if="navigationGroups.length" :aria-label="contextTitle" class="grid gap-2">
          <div v-for="group in navigationGroups" :key="group.id" class="grid gap-2">
            <h3 v-if="group.labelKey" class="text-sm text-muted">{{ t(group.labelKey) }}</h3>
            <UButton
              v-for="link in group.links"
              :key="link.id"
              :to="link.to"
              color="neutral"
              variant="ghost"
              class="nasq-context-link"
              :label="t(link.labelKey)"
              :aria-label="t(link.labelKey)"
              :aria-current="link.active ? 'page' : undefined"
              :data-active="link.active"
              :active="!!link.active"
              :data-testid="`mobile-context-link-${link.id}`"
              @click="closeIfCurrent(link.to)"
            >
              <template #leading>
                <component :is="link.icon" aria-hidden="true" />
              </template>
            </UButton>
          </div>
        </nav>
      </div>
    </template>
  </USlideover>
</template>
