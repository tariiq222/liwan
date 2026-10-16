<script setup lang="ts">
import ProjectCreateForm from '@/components/pmo/projects/ProjectCreateForm.vue'
import { useApi } from '@/composables/useApi'
import { aiApprovalAudit, clearAiDraft, readAiDraft, withCreatedProject, withoutCreated } from '@/utils/aiDraft'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { useProjectList } from '@/composables/useProjects'
import { createdProjectLocation, draftedProjectLocation } from '@/utils/projectCharter'
import type { CharterWizardStep } from '@/utils/charterSteps'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { $api } = useApi()
// `/ai` is a valid way back only here: a Nasq AI draft is approved on this page.
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects', '/ai']))
const aiDraftId = computed(() => (typeof route.query.aiDraft === 'string' ? route.query.aiDraft : null))
const { data: projects, isLoading, error: listError } = useProjectList(ref(false))
const canCreate = computed(() => projects.value?.can_create ?? false)

async function onCreated(id: number) {
  toast.add({ title: t('projects.created'), color: 'success' })
  const draftId = aiDraftId.value
  const handoff = draftId ? readAiDraft(draftId) : null
  const audit = aiApprovalAudit(handoff, id)
  if (!draftId || !audit) {
    router.push(createdProjectLocation(id, returnTo.value))
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
  if (returnTo.value.startsWith('/ai')) router.push(withCreatedProject(returnTo.value, id))
  else router.push(createdProjectLocation(id, returnTo.value))
}

// Cancelling an AI draft drops it; `/ai` reads the return without `created` as a rejection.
function onCancel() {
  if (aiDraftId.value) clearAiDraft(aiDraftId.value)
  router.push(withoutCreated(returnTo.value))
}

// A copy already carries its stages, milestones and tasks, so it opens on its summary.
function onCopied(id: number) {
  toast.add({ title: t('projects.created'), color: 'success' })
  router.push({ path: `/projects/${id}`, query: { returnTo: returnTo.value } })
}

// The project now exists; the walker continues on its charter page at the
// same step, so a draft saved half-way is picked up where it was left.
function onDrafted(id: number, step: CharterWizardStep) {
  if (aiDraftId.value) clearAiDraft(aiDraftId.value)
  toast.add({ title: t('projects.create.drafted'), color: 'success' })
  router.push(draftedProjectLocation(id, step, returnTo.value))
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
      <ProjectCreateForm @created="onCreated" @copied="onCopied" @drafted="onDrafted" @cancel="onCancel" />
    </SharedPageState>
    <p v-if="!hydrated" class="sr-only">{{ t('app.loading') }}</p>
  </SharedCreatePanel>
</template>
