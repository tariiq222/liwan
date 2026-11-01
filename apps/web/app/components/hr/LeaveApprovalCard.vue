<script setup lang="ts">
import type { HrLeaveApprovalProcess } from '@liwan/contracts'
import { joinList } from '@/utils/listFormat'
import { saveErrorMessage } from '@/utils/formFeedback'

// The stages that decide a new leave request, read from the operations process the bridge names. The stages are edited
// in the operations process editor (the route's `href`); a company without a process can create the default one here.
const props = defineProps<{ approval: HrLeaveApprovalProcess }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: createDefault, isPending } = useCreateDefaultLeaveApprovalProcess()
const confirming = ref(false)
const failure = ref<unknown>(null)
const message = computed(() => failure.value ? saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain')) : '')
async function useDefault() {
  if (!hydrated.value || isPending.value || !props.approval.can_manage) return
  failure.value = null
  try {
    await createDefault()
    confirming.value = false
  } catch (error) { failure.value = error }
}
</script>

<template>
  <SharedFormSection panel :title="t('hr.leaveApproval.title')" :description="t('hr.leaveApproval.hint')">
    <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('hr.leaveApproval.saveError')" :description="message" />
    <template v-if="approval.process">
      <ol class="space-y-3">
        <SharedSubCard v-for="(step, index) in approval.process.steps" :key="index" as="li" class="min-w-0">
          <h3 class="text-sm font-semibold text-highlighted">{{ t('hr.leaveApproval.stage', { number: index + 1 }) }}: {{ step.name }}</h3>
          <p class="mt-1 truncate text-sm text-muted">{{ step.resolver_label ?? joinList(step.reviewers.map(person => person.name), t) }}</p>
        </SharedSubCard>
      </ol>
      <UButton v-if="approval.can_manage" class="mt-3" color="neutral" variant="outline" icon="i-lucide-pencil" :to="approval.href" :label="t('hr.leaveApproval.edit')" data-testid="hr-leave-approval-edit" />
    </template>
    <template v-else>
      <p class="text-sm text-muted">{{ t('hr.leaveApproval.empty') }}</p>
      <SharedInlineConfirm v-if="confirming" color="primary" :title="t('hr.leaveApproval.defaultConfirm')" :description="t('hr.leaveApproval.defaultHint')" :confirm-label="t('hr.leaveApproval.confirm')" :cancel-label="t('hr.leaveApproval.cancel')" :pending="isPending" @confirm="useDefault" @cancel="confirming = false" />
      <UButton v-else-if="approval.can_manage" class="mt-3" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="!hydrated" :label="t('hr.leaveApproval.default')" data-testid="hr-leave-approval-default" @click="confirming = true" />
    </template>
  </SharedFormSection>
</template>
