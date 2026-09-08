<script setup lang="ts">
import { GripVertical, Trash2 } from '@lucide/vue'
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

// --- inline rename (double-click, or Enter/Space while the name is focused) --
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
    <p v-if="stages.length === 0" class="text-sm text-muted-foreground">{{ t('projects.stages.empty') }}</p>
    <p v-else id="stage-reorder-help" class="text-xs text-muted-foreground">
      {{ t('projects.stages.reorderHelp') }}
    </p>

    <VueDraggable v-model="localStages" :disabled="disabled" handle=".stage-drag-handle" :animation="150" class="space-y-1" @end="onDragEnd">
      <div v-for="stage in localStages" :key="stage.id" data-testid="stage-row" class="flex flex-wrap items-center gap-2 rounded-md border p-2">
        <button
          type="button"
          class="stage-drag-handle shrink-0 rounded p-1 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="disabled ? 'cursor-not-allowed' : 'cursor-grab'"
          :disabled="disabled"
          :aria-label="t('projects.stages.reorder', { name: stage.name })"
          aria-describedby="stage-reorder-help"
          @keydown="onHandleKeydown($event, stage)"
        >
          <GripVertical class="size-4" />
        </button>

        <Input
          v-if="editingId === stage.id"
          :ref="(el) => { if (stage.id === editingId) renameInputEl = (el as any)?.$el ?? el ?? null }"
          v-model="editDraft"
          class="h-8 flex-1"
          :disabled="disabled"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
          @keydown.escape.stop.prevent="cancelRename"
          @blur="commitRename(stage)"
        />
        <span
          v-else
          role="button"
          :tabindex="hydrated ? 0 : -1"
          class="flex-1 truncate rounded px-1 text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('projects.stages.rename')"
          @dblclick="startRename(stage)"
          @keydown.enter.prevent="startRename(stage)"
          @keydown.space.prevent="startRename(stage)"
        >{{ stage.name }}</span>

        <Toggle
          size="sm"
          :model-value="stage.fold"
          :disabled="disabled"
          :aria-label="t('projects.stages.fold')"
          @update:model-value="(v) => onFoldChange(stage, !!v)"
        >
          {{ t('projects.stages.fold') }}
        </Toggle>

        <template v-if="(stage.task_count ?? 0) === 0">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            data-testid="stage-delete"
            :aria-label="t('projects.stages.delete')"
            :disabled="disabled"
            @click="requestDelete(stage.id)"
          >
            <Trash2 class="size-4" />
          </Button>
          <div v-if="pendingDeleteId === stage.id" class="basis-full space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm" data-testid="stage-delete-confirm">
            <p>{{ t('projects.stages.deleteConfirm') }}</p>
            <div class="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" :disabled="props.busy" @click="cancelDelete">{{ t('app.cancel') }}</Button>
              <Button type="button" variant="destructive" size="sm" :disabled="props.busy" @click="confirmDelete(stage.id)">{{ t('projects.stages.delete') }}</Button>
            </div>
          </div>
        </template>
        <TooltipProvider v-else :delay-duration="0">
          <Tooltip>
            <TooltipTrigger as-child>
              <span>
                <Button variant="ghost" size="icon" type="button" data-testid="stage-delete" :aria-label="t('projects.stages.delete')" disabled>
                  <Trash2 class="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{{ t('projects.stages.notEmpty', { count: stage.task_count }) }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </VueDraggable>

    <div class="flex items-center gap-2">
      <Input
        v-model="newName"
        data-testid="stage-add-input"
        :placeholder="t('projects.stages.addPlaceholder')"
        :disabled="disabled"
        @keydown.enter="submitAdd"
      />
      <Button type="button" :disabled="disabled || !newName.trim()" @click="submitAdd">{{ t('projects.stages.add') }}</Button>
    </div>
  </div>
</template>
