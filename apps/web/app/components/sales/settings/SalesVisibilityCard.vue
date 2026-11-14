<script setup lang="ts">
import type { SalesSettings, SalesVisibility } from '@liwan/contracts'
import { useSalesSettingsCard } from '@/composables/sales/useSalesSettingsCard'

// Who reads which quotations and orders. A change applies to every existing document at once; whoever holds the assign
// right sees every document whatever the choice.
const props = defineProps<{ settings: SalesSettings; canEdit: boolean; reloadSettings: () => Promise<SalesSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useSalesSettingsCard(['visibility'] as const, { settings: () => props.settings, reload: () => props.reloadSettings() })
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const modes: SalesVisibility[] = ['own', 'all']
const items = computed(() => modes.map(value => ({ value, label: t(`sales.settings.visibility.${value}`), description: t(`sales.settings.visibility.${value}Hint`) })))
</script>

<template>
  <SharedSettingsCard id="visibility" v-bind="state" :title="t('sales.settings.visibility.title')" :description="t('sales.settings.visibility.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <SharedOptionCards v-model="draft.visibility" :options="items" :disabled="locked" :label="t('sales.settings.visibility.title')" data-testid="sales-visibility" />
  </SharedSettingsCard>
</template>
