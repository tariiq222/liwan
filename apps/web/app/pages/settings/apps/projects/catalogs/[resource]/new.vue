<script setup lang="ts">
import ProjectCharterReferenceForm from '@/components/pmo/projects/settings/ProjectCharterReferenceForm.vue'
import { isCharterCatalogResource } from '@/composables/useProjectCharterCatalogs'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const { can } = useAccess()
const forbidden = computed(() => !can('pmo.settings.manage'))
const resource = computed(() => (isCharterCatalogResource(route.params.resource) ? route.params.resource : null))
const returnTo = computed(() => {
  const fallback = resource.value ? `/settings/apps/projects/catalogs/${resource.value}` : '/settings/apps/projects'
  return safeReturnTo(route.query.returnTo, fallback, ['/settings/apps/projects', '/projects'])
})
const title = computed(() => resource.value === 'owning-units'
  ? t('settings.projects.catalogs.newUnit')
  : t('settings.projects.catalogs.newType'))

function onSaved() {
  toast.add({ title: t('settings.projects.catalogs.created'), color: 'success', icon: 'i-lucide-circle-check' })
  router.replace(returnTo.value)
}
</script>

<template>
  <SharedCreatePanel :title="title" :description="t('projects.refresh.settings.catalogDescription')" :back-to="returnTo">
    <SharedNotFoundState v-if="!resource" :back-to="returnTo" :back-label="t('settings.projects.catalogs.back')" />
    <SharedForbiddenState v-else-if="forbidden" :description="t('settings.forbidden')" />
    <ProjectCharterReferenceForm v-else :resource="resource" @saved="onSaved" @cancel="router.push(returnTo)" />
  </SharedCreatePanel>
</template>
