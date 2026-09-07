<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import ProjectSettingsForm from '@/components/settings/ProjectSettingsForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { projectSettingsKeys } from '@/composables/useProjectSettings'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('pmo.settings.manage'))
const { data: projectSettings } = useQuery({ queryKey: projectSettingsKeys.all, enabled: false })
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === '/settings/projects')
const sections = computed(() => {
  if (!isBaseRoute.value || forbidden.value || !projectSettings.value) return []
  return [
    { id: 'project-creators', label: t('settings.projects.creators.label') },
    { id: 'project-stages', label: t('settings.projects.defaultStages.label') },
    { id: 'project-requirements', label: t('settings.projects.createRequirements.label') },
    { id: 'project-approval', label: t('settings.projects.approval.label') },
    { id: 'project-reminders', label: t('settings.projects.reminders.label') },
    { id: 'catalogs', label: t('settings.projects.catalogs.title') },
  ]
})
</script>

<template>
  <SettingsLayout :sections>
    <div v-if="isBaseRoute" class="nasq-page-stack nasq-settings-form-page">
      <SharedPageHeader :title="t('settings.projects.title')" />

      <p v-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
      <div v-else class="nasq-panel nasq-panel-body">
        <ProjectSettingsForm />
        <section id="catalogs" class="nasq-form-section nasq-settings-anchor space-y-3">
          <h2 class="font-semibold">{{ t('settings.projects.catalogs.title') }}</h2>
          <p class="text-sm text-muted-foreground">{{ t('settings.projects.catalogs.hint') }}</p>
          <div class="flex flex-wrap gap-3 text-sm">
            <NuxtLink
              :to="{ path: '/settings/projects/catalogs/types', query: returnToQuery(route.fullPath) }"
              class="underline underline-offset-4"
              data-testid="catalog-types-link"
            >
              {{ t('settings.projects.catalogs.types') }}
            </NuxtLink>
            <NuxtLink
              :to="{ path: '/settings/projects/catalogs/owning-units', query: returnToQuery(route.fullPath) }"
              class="underline underline-offset-4"
              data-testid="catalog-units-link"
            >
              {{ t('settings.projects.catalogs.owningUnits') }}
            </NuxtLink>
          </div>
        </section>
      </div>
    </div>
    <NuxtPage v-else />
  </SettingsLayout>
</template>
