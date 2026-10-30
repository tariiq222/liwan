<script setup lang="ts">
import { CrmOutcomeSchema, type CrmOutcome } from '@liwan/contracts'
import { useCrmListEditor, useCrmLostReasons, useCrmOutcomes } from '@/composables/crm/useCrmLists'

// What a call can end in, and what each ending does to the opportunity.
type Effect = CrmOutcome['effect']
const props = defineProps<{ canEdit: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const query = useCrmOutcomes()
const reasons = useCrmLostReasons()
const editor = useCrmListEditor<CrmOutcome, { name: string; effect: Effect }, { name?: string; effect?: Effect; lost_reason_id?: number | null; active?: boolean }>('outcomes', CrmOutcomeSchema)
const rows = computed(() => query.data.value?.items ?? [])
const newName = ref('')
const newEffect = ref<Effect>('follow_up')
const locked = computed(() => !hydrated.value || !props.canEdit)
const effects = computed<Array<{ value: Effect; label: string }>>(() => [
  { value: 'follow_up', label: t('crm.settings.outcomes.followUp') },
  { value: 'won', label: t('crm.settings.outcomes.won') },
  { value: 'lost', label: t('crm.settings.outcomes.lost') },
  { value: 'none', label: t('crm.settings.outcomes.none') },
])
const NO_REASON = 'none'
const reasonItems = computed(() => [
  { value: NO_REASON, label: t('crm.settings.outcomes.noReason') },
  ...(reasons.data.value?.items ?? []).filter(reason => reason.active).map(reason => ({ value: String(reason.id), label: reason.name })),
])
async function add() {
  const name = newName.value.trim()
  if (name && await editor.add({ name, effect: newEffect.value })) newName.value = ''
}
const setReason = (row: CrmOutcome, value: string) => editor.change(row.id, { lost_reason_id: value === NO_REASON ? null : Number(value) })
</script>

<template>
  <SharedSettingsList
    id="outcomes"
    :title="t('crm.settings.outcomes.title')"
    :description="t('crm.settings.outcomes.hint')"
    :can-edit="canEdit"
    :message="editor.message.value"
    :loading="query.isLoading.value"
    :error="query.data.value ? null : query.error.value"
    :empty="!rows.length"
    :adding="editor.busy.value.includes(0)"
    :add-disabled="!newName.trim()"
    @retry="query.refetch"
    @add="add"
  >
    <SharedSettingsListRow
      v-for="row in rows"
      :key="row.id"
      :name="row.name"
      :active="row.active"
      :can-edit="canEdit"
      :busy="editor.busy.value.includes(row.id)"
      @rename="name => editor.change(row.id, { name })"
      @toggle="active => editor.change(row.id, { active })"
    >
      <USelect :model-value="row.effect" class="w-44" :items="effects" :aria-label="t('crm.settings.outcomes.effect')" :disabled="locked || !row.active" @update:model-value="editor.change(row.id, { effect: $event as Effect })" />
      <USelect v-if="row.effect === 'lost'" :model-value="row.lost_reason_id === null ? NO_REASON : String(row.lost_reason_id)" class="w-48" :items="reasonItems" :aria-label="t('crm.settings.outcomes.reason')" :disabled="locked || !row.active" @update:model-value="setReason(row, $event as string)" />
    </SharedSettingsListRow>
    <template #add>
      <UInput v-model="newName" class="min-w-40 flex-1" :placeholder="t('app.list.newName')" :aria-label="t('app.list.newName')" :maxlength="200" :disabled="locked" />
      <USelect v-model="newEffect" class="w-44" :items="effects" :aria-label="t('crm.settings.outcomes.effect')" :disabled="locked" />
    </template>
  </SharedSettingsList>
</template>
