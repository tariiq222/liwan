<script setup lang="ts">
import type { BranchPolicy } from '@webvue/contracts'
import BranchRoleAssignments, { type BranchRoleRow } from '@/components/access/branches/BranchRoleAssignments.vue'
import { ApiError } from '@/composables/useApi'
import { useBranchPolicy, useUpdateBranchPolicy } from '@/composables/useBranchAccess'

const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const forbidden = computed(() => !can('access.users.assign_roles') || !can('access.roles.read'))
const query = useBranchPolicy(computed(() => !forbidden.value))
const update = useUpdateBranchPolicy()
const original = ref<BranchPolicy | null>(null)
const mode = ref<BranchPolicy['mode']>('delegated')
const branches = ref<BranchRoleRow[]>([])
const feedback = ref('')
const saved = ref(false)
const confirmReload = ref(false)
const dirty = computed(() => original.value !== null && (mode.value !== original.value.mode || JSON.stringify(branches.value) !== JSON.stringify(original.value.branches)))
const modeItems = computed(() => ['isolated', 'delegated', 'inherited'].map(value => ({ value, label: t(`access.branches.${value}`) })))
function accept(value: BranchPolicy) {
  original.value = value
  mode.value = value.mode
  branches.value = value.branches.map(branch => ({ ...branch, role_ids: [...branch.role_ids] }))
  feedback.value = ''
  confirmReload.value = false
}
watch(query.data, value => { if (value && !dirty.value) accept(value) }, { immediate: true })
async function save() {
  if (!original.value || forbidden.value || !hydrated.value || update.isPending.value) return
  feedback.value = ''
  saved.value = false
  try {
    const value = await update.mutateAsync({ expected_version: original.value.version, mode: mode.value, branches: branches.value.map(({ id, inherit, role_ids }) => ({ id, inherit: !!inherit, role_ids })) })
    accept(value)
    saved.value = true
  } catch (error) {
    feedback.value = error instanceof ApiError && error.status === 409 ? 'access.errors.conflict' : 'errors.generic'
  }
}
async function reload() {
  const result = await query.refetch()
  if (result.data && !result.error) { accept(result.data); saved.value = false }
}
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('access.branches.title')" back-to="/settings/team" />
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <form v-if="original" class="webvue-form" @submit.prevent="save">
        <SharedUnsavedChanges :dirty="dirty" />
        <p class="text-sm text-muted">{{ t('access.branches.description') }}</p>
        <fieldset :disabled="!hydrated || update.isPending.value" class="grid gap-(--webvue-gap-card)">
          <legend class="sr-only">{{ t('access.branches.title') }}</legend>
          <SharedFormSection panel :title="t('access.branches.mode')">
            <UFormField :label="t('access.branches.mode')" name="branch-mode">
              <USelect v-model="mode" :items="modeItems" class="w-full" :aria-label="t('access.branches.mode')" />
            </UFormField>
            <p class="text-sm text-muted">{{ t(`access.branches.${mode}Hint`) }}</p>
          </SharedFormSection>
          <BranchRoleAssignments v-if="mode === 'inherited'" v-model="branches" :roles="original.roles" inherited :disabled="!hydrated || update.isPending.value" />
          <UAlert v-if="mode === 'inherited' && dirty" color="warning" variant="subtle" :title="t('access.branches.roleWarning')" />
          <UAlert v-if="saved && !dirty" role="status" color="success" variant="subtle" :title="t('access.branches.saved')" />
          <UAlert v-if="feedback" role="alert" color="error" variant="subtle" :title="t(feedback)" />
          <UAlert v-if="confirmReload" color="warning" variant="subtle" :title="t('access.branches.reloadHint')" :actions="[{ label: t('access.branches.confirmReload'), color: 'neutral', variant: 'outline', onClick: reload }]" />
          <SharedFormActions>
            <UButton v-if="feedback" color="neutral" variant="outline" :label="t('access.branches.reload')" @click="confirmReload = true" />
            <UButton type="submit" :label="t('access.save')" :disabled="!dirty || update.isPending.value" :loading="update.isPending.value" />
          </SharedFormActions>
        </fieldset>
      </form>
    </SharedPageState>
  </SharedSettingsPage>
</template>
