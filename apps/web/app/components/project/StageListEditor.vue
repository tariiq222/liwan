<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'
import { moveId, stageMoveIndex, type StageMoveTarget } from '@/composables/stageOrder'

// Presentational: no composable calls here. The host (ProjectSettingsForm)
// owns the mutations and wires every emit to useAddStage/useUpdateStage/
// useReorderStages/useDeleteStage, so this component only ever reflects
// `stages` back out as edit intents.
interface StageRow {
  id: number | string
  name: string
  fold: boolean
  task_count?: number
}

const props = withDefaults(defineProps<{ stages: StageRow[]; busy?: boolean }>(), { busy: false })
const emit = defineEmits<{
  add: [name: string]
  rename: [id: StageRow['id'], name: string]
  fold: [id: StageRow['id'], fold: boolean]
  reorder: [ids: StageRow['id'][]]
  delete: [id: StageRow['id']]
}>()

const { t } = useI18n()
const hydrated = useHydrated()

const disabled = computed(() => !hydrated.value || props.busy)

// vue-draggable-plus mutates this local copy directly while dragging; reset
// it whenever the prop list changes from outside (server refresh after an
// add/rename/delete round-trip invalidates the project detail query).
const localStages = ref<StageRow[]>([...props.stages])
watch(
  () => props.stages,
  (v) => {
    localStages.value = [...v]
  },
  { flush: 'sync' },
)

function onDragEnd() {
  emit(
    'reorder',
    localStages.value.map((s) => s.id),
  )
}

function moveStage(stageId: StageRow['id'], target: StageMoveTarget) {
  if (disabled.value) return
  const from = localStages.value.findIndex((stage) => stage.id === stageId)
  if (from < 0) return
  const to = stageMoveIndex(localStages.value.length, from, target)
  if (from === to) return
  const next = moveId(localStages.value, from, to)
  localStages.value = next
  emit('reorder', next.map((stage) => stage.id))
}

function onHandleKeydown(event: KeyboardEvent, stage: StageRow) {
  const target: StageMoveTarget | null = event.key === 'ArrowUp'
    ? 'up'
    : event.key === 'ArrowDown'
      ? 'down'
      : event.key === 'Home'
        ? 'first'
        : event.key === 'End'
          ? 'last'
          : null
  if (!target) return
  event.preventDefault()
  moveStage(stage.id, target)
}

// --- inline rename ------------------------------------------------------------
const editingId = ref<StageRow['id'] | null>(null)
const editDraft = ref('')
const pendingDeleteId = ref<StageRow['id'] | null>(null)
// The Input sits inside v-for, so a named string ref would be marked
// ref_for by Vue and renameInputEl.value would come back as an array
// ([componentInstance]) instead of the element, leaving focus()/select()
// silently doing nothing. A function ref sidesteps that: Vue calls it with
// the element (or null on unmount) for each v-for instance individually.
const renameInputEl = shallowRef<HTMLInputElement | null>(null)

async function startRename(stage: StageRow) {
  if (disabled.value) return
  editingId.value = stage.id
  editDraft.value = stage.name
  await nextTick()
  const el = renameInputEl.value
  el?.focus()
  el?.select()
}
function cancelRename() {
  editingId.value = null
}
function commitRename(stage: StageRow) {
  editingId.value = null
  const name = editDraft.value.trim()
  if (!name || name === stage.name) return
  emit('rename', stage.id, name)
}

// --- fold --------------------------------------------------------------------
function onFoldChange(stage: StageRow, fold: boolean) {
  emit('fold', stage.id, fold)
}

// --- add ------------------------------------------------------------------------
const newName = ref('')
function submitAdd() {
  const name = newName.value.trim()
  if (!name) return
  emit('add', name)
  newName.value = ''
}

function requestDelete(stageId: StageRow['id']) {
  if (disabled.value) return
  pendingDeleteId.value = stageId
}

function cancelDelete() {
  if (!props.busy) pendingDeleteId.value = null
}

function confirmDelete(stageId: StageRow['id']) {
  if (pendingDeleteId.value !== stageId || disabled.value) return
  pendingDeleteId.value = null
  emit('delete', stageId)
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="stages.length === 0" class="text-sm text-muted">{{ t('projects.stages.empty') }}</p>
    <p v-else id="stage-reorder-help" class="text-xs text-muted">
      {{ t('projects.stages.reorderHelp') }}
    </p>

    <VueDraggable v-model="localStages" :disabled="disabled" handle=".stage-drag-handle" :animation="150" class="space-y-1" @end="onDragEnd">
      <div v-for="stage in localStages" :key="stage.id" data-testid="stage-row" class="flex flex-wrap items-center gap-2 rounded-md border p-2">
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          square
          class="stage-drag-handle shrink-0 rounded p-1 text-muted outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="disabled ? 'cursor-not-allowed' : 'cursor-grab'"
          :disabled="disabled"
          :aria-label="t('projects.stages.reorder', { name: stage.name })"
          aria-describedby="stage-reorder-help"
          @keydown="onHandleKeydown($event, stage)"
        >
          <UIcon name="i-lucide-grip-vertical" class="size-4" />
        </UButton>

        <label v-if="editingId === stage.id" :for="`stage-rename-${stage.id}`" class="grid min-w-0 flex-1 gap-1 text-xs">
          <span>{{ t('projects.stages.rename') }}</span>
          <UInput
            :id="`stage-rename-${stage.id}`"
            :ref="(el) => { if (stage.id === editingId) renameInputEl = (el as any)?.inputRef ?? (el as any)?.$el ?? el ?? null }"
            v-model="editDraft"
            class="w-full"
            size="sm"
            :disabled="disabled"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @keydown.escape.stop.prevent="cancelRename"
            @blur="commitRename(stage)"
          />
        </label>
        <span v-else class="min-w-0 flex-1 truncate px-1 text-start text-sm">{{ stage.name }}</span>

        <UButton
          v-if="editingId !== stage.id"
          type="button"
          color="neutral"
          size="sm"
          :disabled="disabled"
          :aria-label="t('projects.stages.rename')"
          :label="t('projects.stages.rename')"
          @click="startRename(stage)"
        variant="outline" />

        <div class="flex items-center gap-2 text-sm">
          <span class="text-muted">{{ t('projects.stages.fold') }}</span>
          <USwitch
            :model-value="stage.fold"
            :disabled="disabled"
            :aria-label="t('projects.stages.fold')"
            @update:model-value="(v) => onFoldChange(stage, !!v)"
          />
        </div>

        <template v-if="(stage.task_count ?? 0) === 0">
          <UButton
            color="neutral"
            variant="ghost"
            square
            type="button"
            data-testid="stage-delete"
            icon="i-lucide-trash-2"
            :aria-label="t('projects.stages.delete')"
            :disabled="disabled"
            @click="requestDelete(stage.id)"
          />
          <SharedInlineConfirm
            v-if="pendingDeleteId === stage.id"
            class="basis-full"
            data-testid="stage-delete-confirm"
            :title="t('projects.stages.deleteConfirm')"
            :confirm-label="t('projects.stages.delete')"
            :pending="props.busy"
            @cancel="cancelDelete"
            @confirm="confirmDelete(stage.id)"
          />
        </template>
        <UTooltip v-else :text="t('projects.stages.notEmpty', { count: stage.task_count }, stage.task_count)" :delay-duration="0">
          <span>
            <UButton color="neutral" variant="ghost" square type="button" data-testid="stage-delete" icon="i-lucide-trash-2" :aria-label="t('projects.stages.delete')" disabled />
          </span>
        </UTooltip>
      </div>
    </VueDraggable>

    <div class="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label for="stage-add-name" class="grid gap-1 text-sm">
        <span>{{ t('projects.stages.addPlaceholder') }}</span>
        <UInput
          id="stage-add-name"
          v-model="newName"
          class="w-full"
          data-testid="stage-add-input"
          :disabled="disabled"
          @keydown.enter="submitAdd"
        />
      </label>
      <UButton type="button" icon="i-lucide-plus" :disabled="disabled || !newName.trim()" :label="t('projects.stages.add')" @click="submitAdd" />
    </div>
  </div>
</template>
