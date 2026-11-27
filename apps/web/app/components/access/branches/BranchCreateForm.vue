<script setup lang="ts">
import { useCreateBranch } from '@/composables/useCreateBranch'
import { saveErrorMessage } from '@/utils/formFeedback'

// Creates a branch company by its name. The form sits in the create panel of the branches route, so
// its actions live in the panel footer through the form id, and the field error appears after the
// first save attempt (DESIGN.md §6).
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateBranch()
const formId = useId()
const branchName = ref('')
const attempted = ref(false)
const error = ref('')
const saved = ref(false)
const dirty = computed(() => !saved.value && branchName.value.trim().length > 0)

async function submitBranch() {
  attempted.value = true
  if (!hydrated.value || create.isPending.value || !branchName.value.trim()) return
  error.value = ''
  try {
    await create.mutateAsync({ name: branchName.value })
    saved.value = true
    emit('done')
  } catch (cause) {
    error.value = saveErrorMessage(cause, t('errors.generic'), t('errors.saveUncertain'))
  }
}
</script>

<template>
  <form :id="formId" class="liwan-form" novalidate @submit.prevent="submitBranch">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel>
      <UFormField :label="t('access.branches.create.name')" name="branch-name" required :error="attempted && !branchName.trim() ? t('errors.api.invalid') : undefined">
        <UInput v-model="branchName" maxlength="200" class="w-full" required :disabled="!hydrated || create.isPending.value" />
      </UFormField>
    </SharedFormSection>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" :disabled="create.isPending.value" @click="emit('cancel')" />
        <UButton type="submit" color="primary" :form="formId" :label="t('access.branches.create.action')" :loading="create.isPending.value" :disabled="!hydrated || create.isPending.value" />
      </div>
    </SharedFormActions>
  </form>
</template>
