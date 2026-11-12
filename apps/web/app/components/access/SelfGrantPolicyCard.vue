<script setup lang="ts">
import type { AccessPolicy, SelfGrantPolicy } from '@liwan/contracts'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { useUpdateAccessPolicy } from '@/composables/useAccessPolicy'
import { accessSaveError } from '@/utils/accessErrors'

const props = defineProps<{ policy: AccessPolicy; canEdit: boolean; reloadPolicy: () => Promise<AccessPolicy> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const update = useUpdateAccessPolicy()
const { draft, state, save, revert, reload } = useSettingsForm({
  source: () => props.policy,
  read: ({ self_grant }) => ({ self_grant }),
  save: async (values, latest) => {
    try {
      return await update.mutateAsync({ expected_version: latest.version, self_grant: values.self_grant })
    } catch (error) {
      throw accessSaveError(error, t)
    }
  },
  reload: () => props.reloadPolicy(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const modes: SelfGrantPolicy[] = ['restricted', 'allowed']
const items = computed(() => modes.map(value => ({ value, label: t(`access.selfGrant.${value}`), description: t(`access.selfGrant.${value}Hint`) })))
</script>

<template>
  <SharedSettingsCard id="access-policy" v-bind="state" :title="t('access.selfGrant.title')" :description="t('access.selfGrant.description')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <SharedOptionCards v-model="draft.self_grant" :options="items" :disabled="locked" :label="t('access.selfGrant.title')" data-testid="self-grant-policy" />
  </SharedSettingsCard>
</template>
