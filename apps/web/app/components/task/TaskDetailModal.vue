<script setup lang="ts">
import { VisuallyHidden } from 'reka-ui'
import TaskDetailPanel from './TaskDetailPanel.vue'

// Dialog wrapper only — all the header/body logic lives in TaskDetailPanel
// so a later split-view host can reuse it without depending on Dialog.
const props = defineProps<{ taskId: number }>()

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

// Mounted only while the /tasks/{id} route matches, so it is always open;
// closing (Escape, overlay click, header close button) routes back to the
// list, preserving ?tab and any filters.
function close() {
  router.push({ path: '/tasks', query: route.query })
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && close()">
    <DialogContent
      :show-close-button="false"
      class="w-screen max-w-none h-screen gap-0 rounded-none p-0 md:h-[85vh] md:w-full md:max-w-[1100px] md:rounded-lg"
    >
      <VisuallyHidden as-child>
        <DialogTitle>{{ t('tasks.drawer.details') }}</DialogTitle>
      </VisuallyHidden>
      <TaskDetailPanel :task-id="props.taskId" @close="close" />
    </DialogContent>
  </Dialog>
</template>
