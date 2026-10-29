<script setup lang="ts">
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { useBranchStrictness, useUpdateBranchStrictness } from '@/composables/useBranchStrictness'

// One «stricter than the general policy» switch of a sensitive application. It can only narrow: on, the application's
// roles are never inherited into branches and only an explicit delegation opens a branch's records. The card stays
// hidden while the setting cannot be read, so an application without the route shows nothing.
const props = defineProps<{ scope: 'hr' | 'payroll' | 'finance'; path: string; canRead: boolean; canEdit: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const query = useBranchStrictness(props.path, () => props.canRead)
const update = useUpdateBranchStrictness(props.path)
const initial = { scope: props.scope, enabled: false }
const { draft, state, save, revert, reload } = useSettingsForm({
  source: () => query.data.value ?? initial,
  read: ({ enabled }) => ({ enabled }),
  save: (values) => update.mutateAsync({ enabled: values.enabled }),
  reload: async () => {
    const result = await query.refetch()
    if (result.isError || !result.data) throw result.error ?? new Error(t('errors.generic'))
    return result.data
  },
})
const locked = computed(() => !hydrated.value || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard
    v-if="query.data.value" :id="`branch-strict-${scope}`" v-bind="state" :title="t(`access.branches.strict.${scope}.title`)"
    :description="t('access.branches.strict.description')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload"
  >
    <UFormField orientation="horizontal" :label="t('access.branches.strict.label')" :name="`branch-strict-${scope}`" :description="t(`access.branches.strict.${scope}.hint`)">
      <USwitch v-model="draft.enabled" :disabled="locked || !canEdit" :aria-label="t(`access.branches.strict.${scope}.title`)" :data-testid="`branch-strict-${scope}`" />
    </UFormField>
    <UAlert v-if="state.dirty && !draft.enabled" color="warning" variant="subtle" :title="t('access.branches.strict.widens')" />
  </SharedSettingsCard>
</template>
