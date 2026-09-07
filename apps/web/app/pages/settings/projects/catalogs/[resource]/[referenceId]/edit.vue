<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import ProjectCharterReferenceForm from '@/components/settings/ProjectCharterReferenceForm.vue'
import { isCharterCatalogResource, useCharterCatalogItem } from '@/composables/useProjectCharterCatalogs'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('pmo.settings.manage'))
const resource = computed(() => (isCharterCatalogResource(route.params.resource) ? route.params.resource : null))
const referenceId = computed(() => {
  const n = Number(route.params.referenceId)
  return Number.isInteger(n) && n > 0 ? n : null
})
const query = useCharterCatalogItem(
  computed(() => resource.value ?? 'types'),
  referenceId,
  computed(() => !forbidden.value && !!resource.value && !!referenceId.value),
)
const notFound = computed(() => !resource.value || referenceId.value === null || (query.error.value instanceof ApiError && [403, 404].includes(query.error.value.status)))
const returnTo = computed(() => {
  const fallback = resource.value ? `/settings/projects/catalogs/${resource.value}` : '/settings/projects'
  return safeReturnTo(route.query.returnTo, fallback, ['/settings/projects', '/projects'])
})

function onSaved() {
  toast.success(t('settings.projects.catalogs.saved'))
  router.push(returnTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('settings.projects.catalogs.editTitle')" :back-to="returnTo" :back-label="t('settings.projects.catalogs.back')" />
    <p v-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
    <p v-else-if="query.isLoading.value" role="status" class="text-muted-foreground">{{ t('app.loading') }}</p>
    <p v-else-if="notFound" class="text-muted-foreground">{{ t('settings.projects.catalogs.notFound') }}</p>
    <p v-else-if="query.error.value || !query.data.value" role="alert" class="text-destructive">{{ t('settings.projects.catalogs.loadError') }}</p>
    <Card v-else>
      <CardContent class="pt-6">
        <ProjectCharterReferenceForm :resource="resource!" :reference="query.data.value" @saved="onSaved" @cancel="router.push(returnTo)" />
      </CardContent>
    </Card>
  </SharedPageContainer>
</template>
