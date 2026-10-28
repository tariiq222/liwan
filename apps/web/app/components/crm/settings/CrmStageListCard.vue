<script setup lang="ts">
import { CrmStageSchema, type CrmStage } from '@webvue/contracts'
import { useCrmListEditor, useCrmStages, useReorderCrmStages } from '@/composables/crm/useCrmLists'
import { saveErrorMessage } from '@/utils/formFeedback'

// The pipeline: rename, reorder, archive and restore stages, and mark the one stage that means «sold».
const props = defineProps<{ canEdit: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const query = useCrmStages()
const editor = useCrmListEditor<CrmStage, { name: string }, { name?: string; is_won?: boolean; active?: boolean }>('stages', CrmStageSchema)
const reorder = useReorderCrmStages()
const reorderFailure = ref<unknown>(null)
const rows = computed(() => [...(query.data.value?.items ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.sequence - b.sequence))
const activeIds = computed(() => rows.value.filter(row => row.active).map(row => row.id))
const newName = ref('')
const busy = computed(() => reorder.isPending.value || editor.busy.value.length > 0)
const locked = computed(() => !hydrated.value || !props.canEdit || busy.value)
const message = computed(() => editor.message.value || (reorderFailure.value ? saveErrorMessage(reorderFailure.value, t('errors.generic'), t('errors.saveUncertain')) : ''))
async function add() {
  const name = newName.value.trim()
  if (name && await editor.add({ name })) newName.value = ''
}
function rename(row: CrmStage, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim()
  if (name && name !== row.name) void editor.change(row.id, { name })
}
async function move(id: number, step: -1 | 1) {
  const ids = [...activeIds.value]
  const from = ids.indexOf(id)
  const to = from + step
  if (to < 0 || to >= ids.length) return
  ids.splice(to, 0, ids.splice(from, 1)[0]!)
  reorderFailure.value = null
  try { await reorder.mutateAsync(ids) } catch (failure) { reorderFailure.value = failure }
}
</script>

<template>
  <SharedFormSection panel :title="t('crm.settings.stages.title')" :description="t('crm.settings.stages.hint')">
    <SharedPageState :loading="query.isLoading.value" :error="query.data.value ? null : query.error.value" :empty="false" @retry="query.refetch">
      <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('crm.settings.list.saveError')" :description="message" />
      <ul class="grid gap-2">
        <li v-for="row in rows" :key="row.id" class="flex flex-wrap items-center gap-2">
          <UInput :model-value="row.name" class="min-w-40 flex-1" :aria-label="t('crm.settings.list.name')" :maxlength="200" :disabled="locked || !row.active" @change="rename(row, $event)" />
          <USwitch :model-value="row.is_won" :label="t('crm.settings.stages.won')" :disabled="locked || !row.active || row.is_won" @update:model-value="editor.change(row.id, { is_won: true })" />
          <template v-if="canEdit && row.active">
            <UButton type="button" color="neutral" variant="ghost" size="sm" square icon="i-lucide-chevron-up" :aria-label="t('crm.settings.stages.moveUp', { name: row.name })" :disabled="locked || activeIds[0] === row.id" @click="move(row.id, -1)" />
            <UButton type="button" color="neutral" variant="ghost" size="sm" square icon="i-lucide-chevron-down" :aria-label="t('crm.settings.stages.moveDown', { name: row.name })" :disabled="locked || activeIds[activeIds.length - 1] === row.id" @click="move(row.id, 1)" />
          </template>
          <UBadge v-if="!row.active" color="neutral" variant="outline" class="rounded-full" :label="t('crm.settings.list.archived')" />
          <UButton v-if="canEdit" type="button" color="neutral" variant="outline" size="sm" :label="row.active ? t('crm.settings.list.archive') : t('crm.settings.list.restore')" :disabled="locked || row.is_won" @click="editor.change(row.id, { active: !row.active })" />
        </li>
      </ul>
      <form v-if="canEdit" class="flex items-center gap-2" @submit.prevent="add">
        <UInput v-model="newName" class="min-w-0 flex-1" :placeholder="t('crm.settings.list.newName')" :aria-label="t('crm.settings.list.newName')" :maxlength="200" :disabled="locked" />
        <UButton type="submit" icon="i-lucide-plus" :label="t('crm.settings.list.add')" :loading="editor.busy.value.includes(0)" :disabled="locked || !newName.trim()" />
      </form>
    </SharedPageState>
  </SharedFormSection>
</template>
