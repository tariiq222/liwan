<script setup lang="ts">
import type { SegmentedItem } from '@webvue/ui/app/components/shared/data/SegmentedControl.vue'
import { filterDepartmentTree, flattenDepartmentTree, type DepartmentTreeNode } from '@/lib/departmentTree'

const props = defineProps<{
  roots: DepartmentTreeNode[]
  query?: string
  selectedId?: number | null
  canManage: boolean
  canReadEmployees: boolean
  canReadDocuments: boolean
  hydrated: boolean
}>()
const emit = defineEmits<{
  select: [id: number]
  edit: [id: number]
  createChild: [id: number]
}>()

const { t } = useI18n()
const expanded = ref(new Set<number>())
const filteredRoots = computed(() => filterDepartmentTree(props.roots, props.query ?? ''))
const displayedNodes = computed(() => {
  const result: DepartmentTreeNode[] = []
  const searching = Boolean((props.query ?? '').trim())
  const walk = (node: DepartmentTreeNode) => {
    result.push(node)
    if (searching || expanded.value.has(node.department.id)) {
      for (const child of node.children) walk(child)
    }
  }
  for (const root of filteredRoots.value) walk(root)
  return result
})

const isSearching = computed(() => Boolean((props.query ?? '').trim()))

function isExpanded(node: DepartmentTreeNode) {
  return isSearching.value || expanded.value.has(node.department.id)
}

watch(
  () => props.query,
  (query) => {
    if (!query?.trim()) return
    for (const node of flattenDepartmentTree(filteredRoots.value)) expanded.value.add(node.department.id)
  },
  { immediate: true },
)

function nodeActions(node: DepartmentTreeNode): SegmentedItem[] {
  const id = node.department.id
  const items: SegmentedItem[] = []
  if (props.canManage) {
    items.push({ value: 'edit', label: t('hr.depts.edit'), icon: 'i-lucide-pencil' })
    items.push({ value: 'createChild', label: t('hr.depts.newChild'), icon: 'i-lucide-plus' })
  }
  if (props.canReadEmployees) items.push({ value: 'employees', label: t('hr.depts.viewEmployees'), icon: 'i-lucide-users', to: `/hr?department_id=${id}` })
  if (props.canReadDocuments) items.push({ value: 'documents', label: t('hr.depts.viewDocuments'), icon: 'i-lucide-file-text', to: `/documents?context_kind=hr.department&context_id=${id}` })
  return items
}

function runAction(action: string, id: number) {
  if (action === 'edit') emit('edit', id)
  else if (action === 'createChild') emit('createChild', id)
}

function toggle(node: DepartmentTreeNode) {
  if (!node.children.length) return
  const next = new Set(expanded.value)
  if (next.has(node.department.id)) next.delete(node.department.id)
  else next.add(node.department.id)
  expanded.value = next
}
</script>

<template>
  <div v-if="displayedNodes.length" class="min-w-0" data-testid="hr-department-tree">
    <div
      v-for="node in displayedNodes"
      :key="node.department.id"
      class="dept-tree-row relative flex min-w-0 flex-wrap items-center gap-2 border-b border-default py-2.5 pe-3 last:border-b-0 hover:bg-elevated"
      :class="{ 'bg-elevated': selectedId === node.department.id }"
      :style="{ '--dept-depth': String(node.depth) }"
      :data-depth="node.depth"
      :data-testid="`hr-department-tree-row-${node.department.id}`"
    >
      <span v-if="node.depth" class="dept-tree-guide" aria-hidden="true" />
      <span class="relative flex size-8 shrink-0 items-center justify-center">
        <UButton
          v-if="node.children.length"
          type="button"
          color="primary"
          variant="ghost"
          square
          :disabled="!hydrated || isSearching"
          :aria-label="isExpanded(node) ? $t('hr.depts.collapse') : $t('hr.depts.expand')"
          :aria-expanded="isExpanded(node)"
          @click="toggle(node)"
        >
          <span class="dept-tree-chevron inline-flex" :class="{ 'dept-tree-chevron-collapsed': !isExpanded(node) }">
            <UIcon name="i-lucide-chevron-down" class="size-4.5" />
          </span>
        </UButton>
        <span v-else class="size-8" aria-hidden="true" />
      </span>
      <UIcon name="i-lucide-network" class="size-4.5 shrink-0 text-muted" aria-hidden="true" />
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        class="min-w-0 flex-1 rounded-control p-1 py-0.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :disabled="!hydrated"
        @click="emit('select', node.department.id)"
      >
        <span class="block text-pretty break-words text-base font-semibold text-highlighted">{{ node.department.name }}</span>
        <span class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          <span>{{ node.department.manager?.name || $t('hr.depts.noManager') }}</span>
          <span>{{ $t('hr.depts.employeeReason', { count: node.department.employee_count }, node.department.employee_count) }}</span>
          <span v-if="node.children.length">{{ $t('hr.depts.childReason', { count: node.children.length }, node.children.length) }}</span>
        </span>
      </UButton>
      <SharedSegmentedControl
        v-if="nodeActions(node).length"
        mode="actions"
        icon-only
        class="ms-auto max-sm:basis-full max-sm:justify-end"
        :label="node.department.name"
        :items="nodeActions(node)"
        @select="runAction($event, node.department.id)"
      />
    </div>
  </div>
  <SharedEmptyState v-else class="m-(--webvue-card-pad-dense)" :title="$t('hr.depts.empty')" />
</template>
