<script setup lang="ts">
import { toast } from 'vue-sonner'
import ProjectCreateForm from '@/components/project/ProjectCreateForm.vue'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
import { useProjectList } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects']))
const { data: projects, isLoading, error: listError } = useProjectList(ref(false))
const canCreate = computed(() => projects.value?.can_create ?? false)

function onCreated(id: number) {
  toast.success(t('projects.created'))
  router.push({ path: '/projects/' + id, query: returnToQuery(returnTo.value) })
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.new')" :back-to="returnTo" :back-label="t('projects.backToProjects')" />
    <p v-if="isLoading" role="status" class="text-muted-foreground">
      {{ t('projects.loading') }}
    </p>
    <p v-else-if="listError" role="alert" class="text-destructive">
      {{ t('projects.loadError') }}
    </p>
    <p v-else-if="!canCreate" class="text-muted-foreground">
      {{ t('projects.createForbidden') }}
    </p>
    <Card v-else class="nasq-form">
      <CardContent>
        <ProjectCreateForm
          @created="onCreated"
          @cancel="router.push(returnTo)"
        />
      </CardContent>
    </Card>
    <p v-if="!hydrated" class="sr-only">{{ t('app.loading') }}</p>
  </SharedPageContainer>
</template>
