<script setup lang="ts">
import ProjectSettingsForm from '@/components/settings/ProjectSettingsForm.vue'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('pmo.settings.manage'))
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === '/projects/settings')
const catalogs = computed(() => [
  { path: '/projects/settings/catalogs/types', testId: 'catalog-types-link', label: t('settings.projects.catalogs.types') },
  { path: '/projects/settings/catalogs/owning-units', testId: 'catalog-units-link', label: t('settings.projects.catalogs.owningUnits') },
])
</script>

<template>
  <SharedSettingsPage v-if="isBaseRoute" width="form">
    <SharedPageHeader :title="t('settings.projects.title')" :description="t('settings.projects.scopeHint')" />
    <p v-if="forbidden" class="text-muted">{{ t('settings.forbidden') }}</p>
    <div v-else class="webvue-settings-projects grid gap-(--webvue-gap-card)">
      <ProjectSettingsForm />
      <SharedRecordSection id="catalogs" variant="list" class="webvue-settings-anchor" :title="t('settings.projects.catalogs.title')" :description="t('settings.projects.catalogs.hint')">
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
    </div>
  </SharedSettingsPage>
  <NuxtPage v-else />
</template>
