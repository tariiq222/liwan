<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import type { RouteLocationRaw } from 'vue-router'
import { projectIdFromPath, projectSectionRoot, shellRootBackTargets, shellSectionRoot } from '@/composables/useShellNavigation'

const props = defineProps<{
  title: string
  description?: string
  eyebrow?: string
  backTo?: RouteLocationRaw
  backLabel?: string
}>()

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const isProjectRoute = computed(() => projectIdFromPath(route.path) !== null)
const isProjectSectionRoot = computed(() => projectSectionRoot(route.path, route.query) !== null)
const isShellSectionRoot = computed(() => shellSectionRoot(route.path) !== null)
const hideRootBack = computed(() => {
  if (!props.backTo || !isShellSectionRoot.value) return false
  const resolved = router.resolve(props.backTo)
  return !Object.keys(resolved.query ?? {}).length && !resolved.hash && shellRootBackTargets(route.path).includes(resolved.path.replace(/\/+$/, '') || '/')
})
const redundantContextLabels = computed(() => [
  'nav.projects', 'nav.projectDashboard', 'nav.allProjects', 'nav.myProjects',
  'nav.tasks', 'nav.archivedTasks', 'nav.chat', 'nav.newConversation',
  'nav.meetings', 'nav.newMeeting', 'nav.meetingCalendar', 'nav.employees',
  'nav.departments', 'nav.documents', 'nav.humanResources', 'nav.settings',
  'nav.account', 'settings.appearance.title', 'settings.branding.title', 'settings.projects.title',
  'nav.users', 'nav.roles', 'nav.accessLog', 'nav.projectSummary',
  'nav.projectPlanning', 'nav.projectStakeholders', 'nav.projectRisks',
  'nav.projectFinance', 'nav.projectCharter', 'nav.projectSettings',
  'projects.refresh.settings.catalogEyebrow',
].map(key => t(key)))
const hideEyebrow = computed(() => Boolean(props.eyebrow && (
  isProjectRoute.value
  || isShellSectionRoot.value
  || props.eyebrow === props.title
  || redundantContextLabels.value.includes(props.eyebrow)
)))
const hideBack = computed(() => isProjectSectionRoot.value || hideRootBack.value)
const headerDescription = computed(() => (isProjectSectionRoot.value || isShellSectionRoot.value) ? undefined : props.description)

usePageHeader(() => props.title, () => headerDescription.value)
</script>

<template>
  <header
    data-slot="page-header"
    data-empty="false"
    class="flex flex-wrap items-center justify-between gap-3"
  >
    <div class="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div v-if="!hideBack && (props.backTo || $slots.back)" class="mb-1 flex items-center gap-2 text-sm">
          <slot name="back">
            <NuxtLink :to="props.backTo!" class="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ArrowRight aria-hidden="true" class="size-[18px] ltr:rotate-180" />{{ props.backLabel || $t('app.back') }}
            </NuxtLink>
          </slot>
        </div>
        <p v-if="props.eyebrow && !hideEyebrow" class="nasq-page-eyebrow">{{ props.eyebrow }}</p>
        <h1 class="nasq-page-title"><slot name="title">{{ props.title }}</slot></h1>
        <p v-if="headerDescription" class="mt-1 max-w-3xl text-start text-sm leading-6 text-muted-foreground">{{ headerDescription }}</p>
      </div>
      <div v-if="$slots.actions || $slots.default" class="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-2">
        <slot name="actions"><slot /></slot>
      </div>
    </div>
  </header>
</template>
