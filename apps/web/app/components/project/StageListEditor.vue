<script setup lang="ts">
import { GripVertical, Trash2 } from 'lucide-vue-next'
import { VueDraggable } from 'vue-draggable-plus'

// Presentational: no composable calls here. The host (ProjectSettingsDialog)
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

// --- inline rename (double-click, or Enter/Space while the name is focused) --
const editingId = ref<StageRow['id'] | null>(null)
const editDraft = ref('')
// Single ref is safe: only one row is ever in rename mode at a time (the
// Input is v-if'd to just that row), so there is no v-for ref collision.
const renameInputEl = ref<{ $el: HTMLInputElement } | null>(null)

async function startRename(stage: StageRow) {
  if (disabled.value) return
  editingId.value = stage.id
  editDraft.value = stage.name
  await nextTick()
  const el = renameInputEl.value?.$el
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
</script>

<template>
  <div class="space-y-3">
    <p v-if="stages.length === 0" class="text-sm text-muted-foreground">{{ t('projects.stages.empty') }}</p>

    <VueDraggable v-model="localStages" :disabled="disabled" handle=".stage-drag-handle" :animation="150" class="space-y-1" @end="onDragEnd">
      <div v-for="stage in localStages" :key="stage.id" data-testid="stage-row" class="flex items-center gap-2 rounded-md border p-2">
        <GripVertical class="stage-drag-handle size-4 shrink-0 text-muted-foreground" :class="disabled ? 'cursor-not-allowed' : 'cursor-grab'" />

        <Input
          v-if="editingId === stage.id"
          ref="renameInputEl"
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

        <Button
          v-if="(stage.task_count ?? 0) === 0"
          variant="ghost"
          size="icon"
          type="button"
          data-testid="stage-delete"
          :aria-label="t('projects.stages.delete')"
          :disabled="disabled"
          @click="emit('delete', stage.id)"
        >
          <Trash2 class="size-4" />
        </Button>
        <Tooltip v-else>
          <TooltipTrigger as-child>
            <span>
              <Button variant="ghost" size="icon" type="button" data-testid="stage-delete" :aria-label="t('projects.stages.delete')" disabled>
                <Trash2 class="size-4" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{{ t('projects.stages.notEmpty', { count: stage.task_count }) }}</TooltipContent>
        </Tooltip>
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
