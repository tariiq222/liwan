<script setup lang="ts">
import ProjectCreateForm from '@/components/project/ProjectCreateForm.vue'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { useProjectList } from '@/composables/useProjects'
import { createdProjectLocation, draftedProjectLocation } from '@/utils/projectCharter'
import type { CharterWizardStep } from '@/utils/charterSteps'

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

// The project now exists; the walker continues on its charter page at the
// same step, so a draft saved half-way is picked up where it was left.
function onDrafted(id: number, step: CharterWizardStep) {
  toast.add({ title: t('projects.create.drafted'), color: 'success' })
  router.push(draftedProjectLocation(id, step, returnTo.value))
}
</script>

<template>
  <SharedCreatePanel :title="t('projects.new')" :back-to="returnTo" width="wide">
    <SharedPageState
      :loading="isLoading"
      :error="listError"
      :empty="!isLoading && !listError && !canCreate"
      :empty-text="t('projects.createForbidden')"
    >
      <ProjectCreateForm @created="onCreated" @drafted="onDrafted" @cancel="router.push(returnTo)" />
    </SharedPageState>
    <p v-if="!hydrated" class="sr-only">{{ t('app.loading') }}</p>
  </SharedCreatePanel>
</template>
