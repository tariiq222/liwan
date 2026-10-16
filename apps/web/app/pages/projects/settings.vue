<script setup lang="ts">
import ProjectSettingsForm from '@/components/settings/ProjectSettingsForm.vue'
import { returnToQuery } from '@nasq/ui/app/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('pmo.settings.manage'))
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === '/projects/settings')
</script>

<template>
  <SharedSettingsPage v-if="isBaseRoute" width="form">
    <SharedPageHeader :title="t('settings.projects.title')" />
    <p v-if="forbidden" class="text-muted">{{ t('settings.forbidden') }}</p>
    <div v-else class="nasq-settings-projects space-y-6">
      <p class="mb-5 text-sm leading-6 text-muted">{{ t('settings.projects.scopeHint') }}</p>
      <ProjectSettingsForm />
      <SharedRecordSection id="catalogs" class="nasq-settings-anchor" :title="t('settings.projects.catalogs.title')" :description="t('settings.projects.catalogs.hint')">
        <div class="flex flex-wrap gap-3 text-sm">
          <NuxtLink :to="{ path: '/projects/settings/catalogs/types', query: returnToQuery(route.fullPath) }" class="underline underline-offset-4" data-testid="catalog-types-link">{{ t('settings.projects.catalogs.types') }}</NuxtLink>
          <NuxtLink :to="{ path: '/projects/settings/catalogs/owning-units', query: returnToQuery(route.fullPath) }" class="underline underline-offset-4" data-testid="catalog-units-link">{{ t('settings.projects.catalogs.owningUnits') }}</NuxtLink>
        </div>
      </SharedRecordSection>
    </div>
  </SharedSettingsPage>
  <NuxtPage v-else />
</template>
