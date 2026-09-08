<script setup lang="ts">
import { toast } from 'vue-sonner'
import ProjectCharterReferenceForm from '@/components/settings/ProjectCharterReferenceForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { isCharterCatalogResource } from '@/composables/useProjectCharterCatalogs'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('pmo.settings.manage'))
const resource = computed(() => (isCharterCatalogResource(route.params.resource) ? route.params.resource : null))
const returnTo = computed(() => {
  const fallback = resource.value ? `/settings/projects/catalogs/${resource.value}` : '/settings/projects'
  return safeReturnTo(route.query.returnTo, fallback, ['/settings/projects', '/projects'])
})
const title = computed(() => resource.value === 'owning-units'
  ? t('settings.projects.catalogs.newUnit')
  : t('settings.projects.catalogs.newType'))

function onSaved() {
  toast.success(t('settings.projects.catalogs.created'))
  router.push(returnTo.value)
}
</script>

<template>
  <SettingsLayout width="form">
    <SharedPageHeader :title="title" :back-to="returnTo" :back-label="t('settings.projects.catalogs.back')" />
    <p v-if="!resource" class="text-muted-foreground">{{ t('settings.projects.catalogs.notFound') }}</p>
    <p v-else-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
    <section v-else class="nasq-panel nasq-panel-body">
      <ProjectCharterReferenceForm :resource="resource" @saved="onSaved" @cancel="router.push(returnTo)" />
    </section>
  </SettingsLayout>
</template>
