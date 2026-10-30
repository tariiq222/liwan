<script setup lang="ts">
import ProjectCreateForm from '@/components/pmo/projects/ProjectCreateForm.vue'
import { useApi } from '@/composables/useApi'
import { aiApprovalAudit, clearAiDraft, readAiDraft, withCreatedProject, withoutCreated } from '@/utils/aiDraft'
import { owningListBack, recordEntryOrigin } from '@/utils/recordListOrigin'
import { useProjectList } from '@/composables/useProjects'
import { createdProjectLocation, draftedProjectLocation } from '@/utils/projectCharter'
import { parsePositiveId } from '@/utils/routeParams'
import { errorStateKind } from '@liwan/ui/app/utils/errorState'
import type { CharterWizardStep } from '@/utils/charterSteps'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { $api } = useApi()
const aiDraftId = computed(() => (typeof route.query.aiDraft === 'string' ? route.query.aiDraft : null))
// `/ai` is a valid way back only while a LiwanOS AI draft is being approved on this page.
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
  const handoff = draftId ? readAiDraft(draftId) : null
  const audit = aiApprovalAudit(handoff, id)
  if (!draftId || !audit) {
    router.replace(createdProjectLocation(id, returnTo.value))
    return
  }
  // The project exists already, so a failed audit warns but never blocks the way back.
  try {
    await $api('/api/v1/ai/audit', { method: 'POST', body: audit })
  }
  catch {
    toast.add({ title: t('projects.create.aiAuditFailed'), color: 'warning' })
  }
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

// The project now exists; the walker continues on its charter page at the
// same step, so a draft saved half-way is picked up where it was left.
function onDrafted(id: number, step: CharterWizardStep, reason?: string) {
  if (aiDraftId.value) clearAiDraft(aiDraftId.value)
  toast.add({ title: t('projects.create.drafted'), description: reason, color: reason ? 'warning' : 'success' })
  router.replace(draftedProjectLocation(id, step, returnTo.value))
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
      <ProjectCreateForm @created="onCreated" @copied="onCopied" @drafted="onDrafted" @cancel="onCancel" />
    </SharedPageState>
    <p v-if="!hydrated" class="sr-only">{{ t('app.loading') }}</p>
  </SharedCreatePanel>
</template>
