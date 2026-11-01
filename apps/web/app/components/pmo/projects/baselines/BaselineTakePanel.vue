<script setup lang="ts">
import { BASELINE_NOTE_MAX, type ProjectBaselineList } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useTakeBaseline } from '@/composables/useProjectBaselines'

// Taking a baseline, confirmed inline (DESIGN.md: no dialogs). A baseline is a frozen snapshot, so the confirmation says
// so; a controlled project also names the approved change request that covers the new baseline.
const props = defineProps<{ projectId: number; list: ProjectBaselineList }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: take, isPending } = useTakeBaseline()

const confirming = ref(false)
const note = ref('')
const changeId = ref('')
const changeItems = computed(() => props.list.coverable_changes.map(change => ({ value: String(change.id), label: `#${change.number} ${change.title}` })))
const changeMissing = computed(() => props.list.change_required && !changeId.value)

function close() {
  confirming.value = false
  note.value = ''
  changeId.value = ''
}

const ERROR_KEY: Record<string, string> = {
  charter_state: 'projects.baselines.errors.charterState',
  change_required: 'projects.baselines.errors.changeRequired',
  baseline_busy: 'projects.baselines.errors.busy',
}

async function run() {
  if (!hydrated.value || isPending.value || changeMissing.value) return
  try {
    const baseline = await take({ projectId: props.projectId, body: { ...(note.value.trim() ? { note: note.value.trim() } : {}), ...(changeId.value ? { change_id: Number(changeId.value) } : {}) } })
    close()
    toast.add({ title: t('projects.baselines.toast.taken', { number: baseline.number }), color: 'success' })
  }
  catch (error) {
    const key = error instanceof ApiError ? ERROR_KEY[error.code ?? ''] : undefined
    toast.add({ title: key ? t(key) : error instanceof ApiError ? error.message : t('errors.generic'), color: key ? 'warning' : 'error' })
  }
}
</script>

<template>
  <div v-if="list.can_take" class="liwan-print-hide" data-testid="baseline-take-panel">
    <SharedInlineConfirm
      v-if="confirming"
      color="primary"
      data-testid="baseline-take-confirm"
      :title="t('projects.baselines.confirm')"
      :description="t('projects.baselines.confirmHint')"
      :confirm-label="t('projects.baselines.take')"
      :pending="isPending"
      :disabled="changeMissing"
      @cancel="close"
      @confirm="run"
    >
      <div class="mt-2 grid gap-3">
        <UAlert v-if="list.change_required && !changeItems.length" color="warning" variant="subtle" icon="i-lucide-triangle-alert" data-testid="baseline-no-coverable" :title="t('projects.baselines.noCoverable')" />
        <UFormField v-else-if="list.change_required || changeItems.length" :label="t('projects.baselines.change')" :required="list.change_required" :description="list.change_required ? t('projects.baselines.changeRequired') : t('projects.baselines.changeOptional')">
          <USelect v-model="changeId" class="w-full" data-testid="baseline-change" :items="changeItems" :placeholder="t('projects.baselines.changePlaceholder')" :disabled="isPending" />
        </UFormField>
        <UFormField :label="t('projects.baselines.noteLabel')">
          <UTextarea v-model="note" class="w-full" data-testid="baseline-note" :maxlength="BASELINE_NOTE_MAX" :rows="2" :disabled="isPending" />
        </UFormField>
      </div>
    </SharedInlineConfirm>
    <div v-else class="flex justify-end">
      <UButton type="button" icon="i-lucide-flag" data-testid="baseline-take" :disabled="!hydrated" :label="t('projects.baselines.take')" @click="confirming = true" />
    </div>
  </div>
</template>
