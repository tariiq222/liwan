<script setup lang="ts">
import type { BranchStrictness } from '@webvue/contracts'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { useUpdateBranchStrictness } from '@/composables/useBranchStrictness'

// The draft of one strictness switch. The parent keys it by the signed-in user and company, so an unsaved edit never
// outlives the identity it was made for.
const props = defineProps<{ scope: 'hr' | 'payroll' | 'finance'; path: string; strictness: BranchStrictness; canEdit: boolean; reload: () => Promise<BranchStrictness> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const update = useUpdateBranchStrictness(props.path)
const { draft, state, save, revert, reload } = useSettingsForm({
  source: () => props.strictness,
  read: ({ enabled }) => ({ enabled }),
  save: values => update.mutateAsync({ enabled: values.enabled }),
  reload: () => props.reload(),
})
const locked = computed(() => !hydrated.value || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard
    :id="`branch-strict-${scope}`" v-bind="state" :title="t(`access.branches.strict.${scope}.title`)"
    :description="t('access.branches.strict.description')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload"
  >
    <UFormField orientation="horizontal" :label="t('access.branches.strict.label')" :name="`branch-strict-${scope}`" :description="t(`access.branches.strict.${scope}.hint`)">
      <USwitch v-model="draft.enabled" :disabled="locked || !canEdit" :aria-label="t(`access.branches.strict.${scope}.title`)" :data-testid="`branch-strict-${scope}`" />
    </UFormField>
    <UAlert v-if="state.dirty && !draft.enabled" color="warning" variant="subtle" :title="t('access.branches.strict.widens')" />
  </SharedSettingsCard>
</template>
