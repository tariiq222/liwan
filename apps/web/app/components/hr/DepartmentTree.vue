<script setup lang="ts">
import { ChevronDown, FileText, Network, Pencil, Plus, Users } from '@lucide/vue'
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

function toggle(node: DepartmentTreeNode) {
  if (!node.children.length) return
  const next = new Set(expanded.value)
  if (next.has(node.department.id)) next.delete(node.department.id)
  else next.add(node.department.id)
  expanded.value = next
}
</script>

<template>
  <div v-if="displayedNodes.length" class="nasq-panel min-w-0" data-testid="hr-department-tree">
    <div
      v-for="node in displayedNodes"
      :key="node.department.id"
      class="dept-tree-row relative flex min-w-0 flex-wrap items-center gap-2 border-b border-border py-2.5 pe-3 last:border-b-0 hover:bg-muted/60"
      :class="{ 'bg-muted/70': selectedId === node.department.id }"
      :style="{ '--dept-depth': String(node.depth) }"
      :data-depth="node.depth"
      :data-testid="`hr-department-tree-row-${node.department.id}`"
    >
      <span v-if="node.depth" class="dept-tree-guide" aria-hidden="true" />
      <span class="relative flex size-8 shrink-0 items-center justify-center">
        <Button
          v-if="node.children.length"
          type="button"
          variant="ghost"
          size="icon-sm"
          class="size-8 rounded-md"
          :disabled="!hydrated || isSearching"
          :aria-label="isExpanded(node) ? $t('hr.depts.collapse') : $t('hr.depts.expand')"
          :aria-expanded="isExpanded(node)"
          @click="toggle(node)"
        >
          <span class="dept-tree-chevron inline-flex" :class="{ 'dept-tree-chevron-collapsed': !isExpanded(node) }">
            <ChevronDown class="size-[18px]" />
          </span>
        </Button>
        <span v-else class="size-8" aria-hidden="true" />
      </span>
      <Network class="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
      <button
        type="button"
        class="min-w-0 flex-1 rounded-md px-1 py-0.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="!hydrated"
        @click="emit('select', node.department.id)"
      >
        <span class="block text-pretty break-words font-medium">{{ node.department.name }}</span>
        <span class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{{ node.department.manager?.name || $t('hr.depts.noManager') }}</span>
          <span>{{ $t('hr.depts.employeeReason', { count: node.department.employee_count }) }}</span>
          <span v-if="node.children.length">{{ $t('hr.depts.childReason', { count: node.children.length }) }}</span>
        </span>
      </button>
      <div
        v-if="canManage || canReadEmployees || canReadDocuments"
        class="ms-auto flex min-w-0 shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5 max-sm:basis-full max-sm:justify-end"
        role="group"
        :aria-label="node.department.name"
      >
        <Button
          v-if="canManage"
          type="button"
          variant="ghost"
          size="icon-sm"
          class="size-8 rounded-md"
          :disabled="!hydrated"
          :aria-label="$t('hr.depts.edit')"
          @click="emit('edit', node.department.id)"
        >
          <Pencil class="size-[18px]" />
        </Button>
        <Button
          v-if="canManage"
          type="button"
          variant="ghost"
          size="icon-sm"
          class="size-8 rounded-md"
          :disabled="!hydrated"
          :aria-label="$t('hr.depts.newChild')"
          @click="emit('createChild', node.department.id)"
        >
          <Plus class="size-[18px]" />
        </Button>
        <NuxtLink
          v-if="canReadEmployees"
          :to="`/hr?department_id=${node.department.id}`"
          class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="$t('hr.depts.viewEmployees')"
        >
          <Users class="size-[18px]" />
        </NuxtLink>
        <NuxtLink
          v-if="canReadDocuments"
          :to="`/hr/documents?department_id=${node.department.id}`"
          class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="$t('hr.depts.viewDocuments')"
        >
          <FileText class="size-[18px]" />
        </NuxtLink>
      </div>
    </div>
  </div>
  <p v-else class="nasq-panel nasq-panel-body py-10 text-center text-sm text-muted-foreground">{{ $t('hr.depts.empty') }}</p>
</template>

<style scoped>
.dept-tree-row {
  --dept-indent: 1.25rem;
  padding-inline-start: calc(0.75rem + (var(--dept-depth, 0) * var(--dept-indent)));
}
@media (max-width: 640px) {
  .dept-tree-row { --dept-indent: 0.7rem; }
}
.dept-tree-guide {
  position: absolute;
  inset-inline-start: calc(0.75rem + ((var(--dept-depth) - 1) * var(--dept-indent)) + 0.95rem);
  inset-block-start: 0;
  height: 50%;
  width: 1px;
  background: var(--border);
  pointer-events: none;
}
.dept-tree-guide::after {
  content: "";
  position: absolute;
  inset-inline-start: 0;
  inset-block-end: 0;
  width: calc(var(--dept-indent) - 0.3rem);
  height: 1px;
  background: var(--border);
}
.dept-tree-chevron { transition: transform 150ms ease-out; }
.dept-tree-chevron-collapsed { transform: rotate(-90deg); }
.dept-tree-chevron-collapsed:dir(rtl) { transform: rotate(90deg); }
</style>
