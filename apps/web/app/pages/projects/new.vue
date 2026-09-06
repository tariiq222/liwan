<script setup lang="ts">
import { toast } from 'vue-sonner'
import ProjectCreateForm from '@/components/project/ProjectCreateForm.vue'
import { safeReturnTo } from '@/utils/safeReturnTo'
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
  router.push('/projects/' + id)
}
</script>

<template>
  <section class="mx-auto w-full max-w-2xl space-y-6">
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
    <Card v-else>
      <CardContent class="pt-6">
        <ProjectCreateForm
          @created="onCreated"
          @cancel="router.push(returnTo)"
        />
      </CardContent>
    </Card>
    <p v-if="!hydrated" class="sr-only">{{ t('app.loading') }}</p>
  </section>
</template>
