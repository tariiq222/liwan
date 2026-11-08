<script setup lang="ts">
import ProjectCreateForm from '@/components/pmo/projects/ProjectCreateForm.vue'
import { clearAiDraft, readAiDraft, withCreatedProject, withoutCreated } from '@/utils/aiDraft'
import { owningListBack, recordEntryOrigin } from '@/utils/recordListOrigin'
import { useProjectList } from '@/composables/useProjects'
import { createdProjectLocation } from '@/utils/projectCharter'
import { parsePositiveId } from '@/utils/routeParams'
import { errorStateKind } from '@liwan/ui/app/utils/errorState'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const aiDraftId = computed(() => (typeof route.query.aiDraft === 'string' ? route.query.aiDraft : null))
// `/ai` is a valid way back only while a Liwan AI draft is being approved on this page.
const sourcePaths = useRecordListPaths(() => ['/projects', '/projects/dashboard', ...(aiDraftId.value ? ['/ai'] : [])])
const returnTo = computed(() => {
  const copyId = parsePositiveId(route.query.copyFrom)
  const parent = copyId ? recordEntryOrigin(route.query.returnTo, `/projects/${copyId}`, sourcePaths.value) : undefined
  return parent ?? router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath
})
const { data: projects, isLoading, error: listError } = useProjectList(ref(false), { limit: 1 })
const canCreate = computed(() => projects.value?.can_create ?? false)
// A refused list read means the same as a refused create policy: an in-page notice with the way back, not a bare 403.
const forbidden = computed(() => errorStateKind(listError.value) === 'forbidden' || (!isLoading.value && !listError.value && !canCreate.value))

async function onCreated(id: number) {
  toast.add({ title: t('projects.created'), color: 'success' })
  const draftId = aiDraftId.value
  if (!draftId || !readAiDraft(draftId)) {
    router.replace(createdProjectLocation(id, returnTo.value))
    return
  }
  // The draft was approved by creating this project, and `/ai` records that approval on the server when it resumes the
  // draft's call with this id (issue #556): the browser writes no audit row and asserts nothing about itself.
  clearAiDraft(draftId)
  if (returnTo.value.startsWith('/ai')) router.replace(withCreatedProject(returnTo.value, id))
  else router.replace(createdProjectLocation(id, returnTo.value))
}

// Cancelling an AI draft drops it; `/ai` reads the return without `created` as a rejection.
function onCancel() {
  if (aiDraftId.value) clearAiDraft(aiDraftId.value)
  router.push(withoutCreated(returnTo.value))
}

// A copy already carries its stages, milestones and tasks, so it opens on its summary.
function onCopied(id: number) {
  toast.add({ title: t('projects.created'), color: 'success' })
  router.replace({ path: `/projects/${id}`, query: { returnTo: returnTo.value } })
}

</script>

<template>
  <SharedCreatePanel :title="t('projects.new')" :back-to="returnTo">
    <SharedPageState
      :loading="isLoading"
      :error="forbidden ? undefined : listError"
      :empty="forbidden"
      :empty-text="t('projects.createForbidden')"
    >
      <template #emptyAction>
        <UButton to="/projects" color="neutral" variant="outline">{{ t('projects.backToProjects') }}</UButton>
      </template>
      <ProjectCreateForm @created="onCreated" @copied="onCopied" @cancel="onCancel" />
    </SharedPageState>
    <p v-if="!hydrated" class="sr-only">{{ t('app.loading') }}</p>
  </SharedCreatePanel>
</template>
