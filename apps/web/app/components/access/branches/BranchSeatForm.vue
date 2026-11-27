<script setup lang="ts">
import { MAX_SEAT_PRIORITY, type BranchSeat } from '@liwan/contracts'
import { useSetBranchSeat } from '@/composables/useBranchAccess'
import { accessErrorMessage } from '@/utils/accessErrors'

// Edits one branch's seat: its read-only state and its reopening priority. The page keys this form by
// the signed-in identity and the branch, so a draft never outlives the account it was made for.
const props = defineProps<{ branch: BranchSeat; identity: string | null }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const setBranchSeat = useSetBranchSeat()
const formId = useId()
const draftIdentity = props.identity
const draftReadOnly = ref(props.branch.read_only)
const draftPriority = ref<number | undefined>(props.branch.restore_priority)
const attempted = ref(false)
const saved = ref(false)
const dirty = computed(() => !saved.value && (draftReadOnly.value !== props.branch.read_only || draftPriority.value !== props.branch.restore_priority))
const priorityValid = computed(() => draftPriority.value !== undefined && Number.isInteger(draftPriority.value) && draftPriority.value >= 0 && draftPriority.value <= MAX_SEAT_PRIORITY)
const error = ref('')

async function saveBranchSeat() {
  attempted.value = true
  const priority = draftPriority.value
  if (draftIdentity !== props.identity || !hydrated.value || setBranchSeat.isPending.value || !dirty.value || !priorityValid.value || priority === undefined) return
  error.value = ''
  try {
    await setBranchSeat.mutateAsync({ id: props.branch.id, body: {
      ...(draftReadOnly.value !== props.branch.read_only ? { read_only: draftReadOnly.value } : {}),
      ...(priority !== props.branch.restore_priority ? { priority } : {}),
    } })
    if (draftIdentity !== props.identity) return
    saved.value = true
    emit('done')
  } catch (cause) {
    error.value = accessErrorMessage(cause, t)
  }
}
</script>

<template>
  <form :id="formId" class="liwan-form" novalidate @submit.prevent="saveBranchSeat">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel>
      <UCheckbox v-model="draftReadOnly" :label="t('access.seats.markReadOnly')" :description="t('access.seats.branchReadOnlyHint')" :disabled="!hydrated || setBranchSeat.isPending.value" />
      <UFormField :label="t('access.seats.priority')" :help="t('access.seats.priorityHint')" :error="attempted && !priorityValid ? t('access.seats.priorityInvalid') : undefined" name="branch-seat-priority">
        <UInputNumber v-model="draftPriority" :min="0" :max="MAX_SEAT_PRIORITY" :disabled="!hydrated || setBranchSeat.isPending.value" />
      </UFormField>
    </SharedFormSection>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" :disabled="setBranchSeat.isPending.value" @click="emit('cancel')" />
        <UButton type="submit" color="primary" :form="formId" :label="t('access.seats.save')" :loading="setBranchSeat.isPending.value" :disabled="!hydrated || setBranchSeat.isPending.value || !dirty" />
      </div>
    </SharedFormActions>
  </form>
</template>
