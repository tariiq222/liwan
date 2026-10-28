<script setup lang="ts">
import { CrmOutcomeSchema, type CrmOutcome } from '@webvue/contracts'
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
function rename(row: CrmOutcome, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim()
  if (name && name !== row.name) void editor.change(row.id, { name })
}
const setReason = (row: CrmOutcome, value: string) => editor.change(row.id, { lost_reason_id: value === NO_REASON ? null : Number(value) })
</script>

<template>
  <SharedFormSection panel :title="t('crm.settings.outcomes.title')" :description="t('crm.settings.outcomes.hint')">
    <SharedPageState :loading="query.isLoading.value" :error="query.data.value ? null : query.error.value" :empty="false" @retry="query.refetch">
      <UAlert v-if="editor.message.value" role="alert" color="error" variant="subtle" :title="t('crm.settings.list.saveError')" :description="editor.message.value" />
      <ul class="grid gap-2">
        <li v-for="row in rows" :key="row.id" class="flex flex-wrap items-center gap-2">
          <UInput :model-value="row.name" class="min-w-40 flex-1" :aria-label="t('crm.settings.list.name')" :maxlength="200" :disabled="locked || !row.active" @change="rename(row, $event)" />
          <USelect :model-value="row.effect" class="w-44" :items="effects" :aria-label="t('crm.settings.outcomes.effect')" :disabled="locked || !row.active" @update:model-value="editor.change(row.id, { effect: $event as Effect })" />
          <USelect v-if="row.effect === 'lost'" :model-value="row.lost_reason_id === null ? NO_REASON : String(row.lost_reason_id)" class="w-48" :items="reasonItems" :aria-label="t('crm.settings.outcomes.reason')" :disabled="locked || !row.active" @update:model-value="setReason(row, $event as string)" />
          <UBadge v-if="!row.active" color="neutral" variant="outline" class="rounded-full" :label="t('crm.settings.list.archived')" />
          <UButton v-if="canEdit" type="button" color="neutral" variant="outline" size="sm" :label="row.active ? t('crm.settings.list.archive') : t('crm.settings.list.restore')" :disabled="locked || editor.busy.value.includes(row.id)" @click="editor.change(row.id, { active: !row.active })" />
        </li>
      </ul>
      <form v-if="canEdit" class="flex flex-wrap items-center gap-2" @submit.prevent="add">
        <UInput v-model="newName" class="min-w-40 flex-1" :placeholder="t('crm.settings.list.newName')" :aria-label="t('crm.settings.list.newName')" :maxlength="200" :disabled="locked" />
        <USelect v-model="newEffect" class="w-44" :items="effects" :aria-label="t('crm.settings.outcomes.effect')" :disabled="locked" />
        <UButton type="submit" icon="i-lucide-plus" :label="t('crm.settings.list.add')" :loading="editor.busy.value.includes(0)" :disabled="locked || !newName.trim()" />
      </form>
    </SharedPageState>
  </SharedFormSection>
</template>
