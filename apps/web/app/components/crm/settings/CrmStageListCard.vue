<script setup lang="ts">
import { CrmStageSchema, type CrmStage } from '@liwan/contracts'
import { useArchiveCrmStage, useCrmListEditor, useCrmStages, useReorderCrmStages } from '@/composables/crm/useCrmLists'
import { useCrmStageArchive } from '@/composables/crm/useCrmStageArchive'
import { crmListErrorMessage } from '@/utils/crmErrors'

// The pipeline: rename, reorder, archive and restore stages, and mark the one stage that means «sold».
const props = defineProps<{ canEdit: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const query = useCrmStages()
const editor = useCrmListEditor<CrmStage, { name: string }, { name?: string; is_won?: boolean; active?: boolean }>('stages', CrmStageSchema)
const reorder = useReorderCrmStages()
const reorderFailure = ref<unknown>(null)
const archiveStage = useArchiveCrmStage()
const archiving = useCrmStageArchive(input => archiveStage.mutateAsync(input))
const rows = computed(() => [...(query.data.value?.items ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.sequence - b.sequence))
const activeIds = computed(() => rows.value.filter(row => row.active).map(row => row.id))
const newName = ref('')
const busy = computed(() => reorder.isPending.value || archiving.pending.value || editor.busy.value.length > 0)
// Where the opportunities of the stage being archived can go: another active stage that is not the sold one.
const targets = computed(() => rows.value.filter(row => row.active && !row.is_won && row.id !== archiving.choosing.value).map(row => ({ label: row.name, value: row.id })))
const locked = computed(() => !hydrated.value || !props.canEdit || busy.value)
const message = computed(() => editor.message.value || [reorderFailure.value, archiving.failure.value].filter(Boolean).map(failure => crmListErrorMessage(failure, t))[0] || '')
async function add() {
  const name = newName.value.trim()
  if (name && await editor.add({ name })) newName.value = ''
}
function toggle(row: CrmStage, active: boolean) {
  if (active) return editor.change(row.id, { active })
  return archiving.request(row.id)
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
      @toggle="active => toggle(row, active)"
    >
      <SharedSettingRow :label="t('crm.settings.stages.won')">
        <USwitch :model-value="row.is_won" :aria-label="t('crm.settings.stages.won')" :disabled="locked || !row.active || row.is_won" @update:model-value="editor.change(row.id, { is_won: true })" />
      </SharedSettingRow>
      <div v-if="archiving.choosing.value === row.id" class="flex basis-full flex-wrap items-center gap-2" data-testid="stage-move-target">
        <p class="text-sm text-muted">{{ t('crm.settings.stages.moveHint') }}</p>
        <USelect v-model="archiving.target.value" class="min-w-40" :items="targets" :placeholder="t('crm.settings.stages.moveTo')" :aria-label="t('crm.settings.stages.moveTo')" :disabled="locked" />
        <UButton type="button" color="primary" size="sm" :label="t('crm.settings.stages.moveAndArchive')" :disabled="locked || archiving.target.value === undefined" @click="archiving.confirm" />
        <UButton type="button" color="neutral" variant="ghost" size="sm" :label="t('app.cancel')" :disabled="locked" @click="archiving.cancel" />
      </div>
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
