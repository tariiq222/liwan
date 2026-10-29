<script setup lang="ts">
import ProjectSettingsForm from '@/components/settings/ProjectSettingsForm.vue'
import { useProjectSettings } from '@/composables/useProjectSettings'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const { parts, shows } = useSettingsPage('projects')
const { data: settings, isLoading, error, refetch } = useProjectSettings(() => shows('project-creation'))
// Each card of the form carries its own anchor; until it renders (loading or a failed load) an empty target keeps the sub-list links working.
const CARD_IDS = ['project-creation', 'project-defaults', 'project-approval', 'project-reminders', 'project-extensions']
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === '/settings/apps/projects')
const catalogs = computed(() => [
  { path: '/settings/apps/projects/catalogs/types', testId: 'catalog-types-link', label: t('settings.projects.catalogs.types') },
  { path: '/settings/apps/projects/catalogs/owning-units', testId: 'catalog-units-link', label: t('settings.projects.catalogs.owningUnits') },
])
</script>

<template>
  <SharedSettingsPage v-if="isBaseRoute" width="form">
    <SharedPageHeader :title="t('nav.projects')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('settings.forbidden')" />
    <template v-else>
      <template v-if="!settings"><span v-for="id in CARD_IDS" :id="id" :key="id" class="webvue-settings-anchor block h-0" /></template>
      <SharedPageState v-if="shows('project-creation')" :loading="isLoading" :error="error" @retry="refetch()">
        <ProjectSettingsForm v-if="settings" :settings="settings" :can-edit="can('pmo.settings.manage')" />
      </SharedPageState>
      <SharedRecordSection v-if="shows('catalogs')" id="catalogs" variant="list" class="webvue-settings-anchor" :title="t('settings.projects.catalogs.title')" :description="t('settings.projects.catalogs.hint')">
        <NuxtLink
          v-for="catalog in catalogs"
          :key="catalog.testId"
          :to="{ path: catalog.path, query: returnToQuery(route.fullPath) }"
          :data-testid="catalog.testId"
          class="flex items-center justify-between gap-3 px-(--webvue-card-pad) py-3 text-sm font-medium text-highlighted transition-colors duration-150 hover:bg-(--webvue-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
        >
          {{ catalog.label }}
          <UIcon name="i-lucide-chevron-right" class="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
        </NuxtLink>
      </SharedRecordSection>
    </template>
  </SharedSettingsPage>
  <NuxtPage v-else />
</template>
