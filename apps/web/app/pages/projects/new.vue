<script setup lang="ts">
import ProjectCreateForm from '@/components/project/ProjectCreateForm.vue'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { useProjectList } from '@/composables/useProjects'
import { createdProjectLocation } from '@/utils/projectCharter'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects']))
const { data: projects, isLoading, error: listError } = useProjectList(ref(false))
const canCreate = computed(() => projects.value?.can_create ?? false)

function onCreated(id: number) {
  toast.add({ title: t('projects.created'), color: 'success' })
  router.push(createdProjectLocation(id, returnTo.value))
}
</script>

<template>
  <SharedCreatePanel :title="t('projects.new')" :back-to="returnTo" width="wide">
    <p v-if="isLoading" role="status" class="text-muted">
      {{ t('projects.loading') }}
    </p>
    <p v-else-if="listError" role="alert" class="text-error">
      {{ t('projects.loadError') }}
    </p>
    <p v-else-if="!canCreate" class="text-muted">
      {{ t('projects.createForbidden') }}
    </p>
    <ProjectCreateForm
      v-else
      @created="onCreated"
      @cancel="router.push(returnTo)"
    />
    <p v-if="!hydrated" class="sr-only">{{ t('app.loading') }}</p>
  </SharedCreatePanel>
</template>
