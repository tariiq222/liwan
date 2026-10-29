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
  <SharedSettingsList
    id="stages"
    :title="t('crm.settings.stages.title')"
    :description="t('crm.settings.stages.hint')"
    :can-edit="canEdit"
    :message="message"
    :loading="query.isLoading.value"
    :error="query.data.value ? null : query.error.value"
    :empty="!rows.length"
    :adding="editor.busy.value.includes(0)"
    :add-disabled="busy || !newName.trim()"
    @retry="query.refetch"
    @add="add"
  >
    <SharedSettingsListRow
      v-for="row in rows"
      :key="row.id"
      :name="row.name"
      :active="row.active"
      :can-edit="canEdit"
      :busy="busy"
      :archive-disabled="row.is_won"
      @rename="name => editor.change(row.id, { name })"
      @toggle="active => editor.change(row.id, { active })"
    >
      <UFormField orientation="horizontal" :label="t('crm.settings.stages.won')">
        <USwitch :model-value="row.is_won" :aria-label="t('crm.settings.stages.won')" :disabled="locked || !row.active || row.is_won" @update:model-value="editor.change(row.id, { is_won: true })" />
      </UFormField>
      <template v-if="canEdit && row.active">
        <UButton type="button" color="neutral" variant="ghost" size="sm" square icon="i-lucide-chevron-up" :aria-label="t('crm.settings.stages.moveUp', { name: row.name })" :disabled="locked || activeIds[0] === row.id" @click="move(row.id, -1)" />
        <UButton type="button" color="neutral" variant="ghost" size="sm" square icon="i-lucide-chevron-down" :aria-label="t('crm.settings.stages.moveDown', { name: row.name })" :disabled="locked || activeIds[activeIds.length - 1] === row.id" @click="move(row.id, 1)" />
      </template>
    </SharedSettingsListRow>
    <template #add>
      <UInput v-model="newName" class="min-w-40 flex-1" :placeholder="t('app.list.newName')" :aria-label="t('app.list.newName')" :maxlength="200" :disabled="locked" />
    </template>
  </SharedSettingsList>
</template>
