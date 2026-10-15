<script setup lang="ts">
import ProjectCreateForm from '@/components/pmo/projects/ProjectCreateForm.vue'
import { owningListBack, recordEntryOrigin } from '@/utils/recordListOrigin'
import { useProjectList } from '@/composables/useProjects'
import { createdProjectLocation, draftedProjectLocation } from '@/utils/projectCharter'
import { parsePositiveId } from '@/utils/routeParams'
import type { CharterWizardStep } from '@/utils/charterSteps'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const sourcePaths = useRecordListPaths(['/projects', '/projects/dashboard'])
const returnTo = computed(() => {
  const copyId = parsePositiveId(route.query.copyFrom)
  const parent = copyId ? recordEntryOrigin(route.query.returnTo, `/projects/${copyId}`, sourcePaths.value) : undefined
  return parent ?? router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath
})
const { data: projects, isLoading, error: listError } = useProjectList(ref(false))
const canCreate = computed(() => projects.value?.can_create ?? false)

function onCreated(id: number) {
  toast.add({ title: t('projects.created'), color: 'success' })
  router.replace(createdProjectLocation(id, returnTo.value))
}

// A copy already carries its stages, milestones and tasks, so it opens on its summary.
function onCopied(id: number) {
  toast.add({ title: t('projects.created'), color: 'success' })
  router.replace({ path: `/projects/${id}`, query: { returnTo: returnTo.value } })
}

// The project now exists; the walker continues on its charter page at the
// same step, so a draft saved half-way is picked up where it was left.
function onDrafted(id: number, step: CharterWizardStep, reason?: string) {
  toast.add({ title: t('projects.create.drafted'), description: reason, color: reason ? 'warning' : 'success' })
  router.replace(draftedProjectLocation(id, step, returnTo.value))
}
</script>

<template>
  <SharedCreatePanel :title="t('projects.new')" :back-to="returnTo">
    <SharedPageState
      :loading="isLoading"
      :error="listError"
      :empty="!isLoading && !listError && !canCreate"
      :empty-text="t('projects.createForbidden')"
    >
      <ProjectCreateForm @created="onCreated" @copied="onCopied" @drafted="onDrafted" @cancel="router.push(returnTo)" />
    </SharedPageState>
    <p v-if="!hydrated" class="sr-only">{{ t('app.loading') }}</p>
  </SharedCreatePanel>
</template>
