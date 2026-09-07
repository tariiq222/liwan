<script setup lang="ts">
import { ChevronDown, FileText, Pencil, Plus, Users } from '@lucide/vue'
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
  <div v-if="displayedNodes.length" class="grid gap-1">
    <div
      v-for="node in displayedNodes"
      :key="node.department.id"
      class="department-tree-row flex min-w-0 flex-wrap items-center gap-1 rounded-md border border-transparent p-1.5"
      :class="{ 'border-border bg-accent/50': selectedId === node.department.id }"
      :style="{ '--department-indent': `${node.depth * 1.5}rem` }"
    >
      <Button
        v-if="node.children.length"
        type="button"
        variant="ghost"
        size="icon"
        class="size-[32px] shrink-0 rounded-lg border border-border"
        :disabled="!hydrated || isSearching"
        :aria-label="isExpanded(node) ? $t('hr.depts.collapse') : $t('hr.depts.expand')"
        :aria-expanded="isExpanded(node)"
        @click="toggle(node)"
      >
        <ChevronDown class="size-[18px] transition-transform" :class="{ '-rotate-90': !isExpanded(node) }" />
      </Button>
      <span v-else class="size-[32px] shrink-0" aria-hidden="true" />
      <button
        type="button"
        class="min-w-0 flex-1 rounded px-1 py-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="!hydrated"
        @click="emit('select', node.department.id)"
      >
        <span class="block truncate font-medium">{{ node.department.name }}</span>
        <span v-if="node.department.manager" class="block truncate text-xs text-muted-foreground">
          {{ node.department.manager.name }}
        </span>
        <span v-else class="block truncate text-xs text-muted-foreground">{{ $t('hr.depts.noManager') }}</span>
      </button>
      <div class="department-tree-actions flex shrink-0 items-center gap-0.5 max-sm:basis-full max-sm:w-full max-sm:justify-end">
        <Button
          v-if="canManage"
          type="button"
          variant="ghost"
          size="icon"
          class="size-[32px] rounded-lg border border-border"
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
          size="icon"
          class="size-[32px] rounded-lg border border-border"
          :disabled="!hydrated"
          :aria-label="$t('hr.depts.newChild')"
          @click="emit('createChild', node.department.id)"
        >
          <Plus class="size-[18px]" />
        </Button>
        <NuxtLink
          v-if="canReadEmployees"
          :to="`/hr?department_id=${node.department.id}`"
          class="inline-flex size-[32px] items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          :aria-label="$t('hr.depts.viewEmployees')"
        >
          <Users class="size-[18px]" />
        </NuxtLink>
        <NuxtLink
          v-if="canReadDocuments"
          :to="`/hr/documents?department_id=${node.department.id}`"
          class="inline-flex size-[32px] items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          :aria-label="$t('hr.depts.viewDocuments')"
        >
          <FileText class="size-[18px]" />
        </NuxtLink>
      </div>
    </div>
  </div>
  <p v-else class="py-10 text-center text-sm text-muted-foreground">{{ $t('hr.depts.empty') }}</p>
</template>

<style scoped>
.department-tree-row {
  padding-inline-start: calc(0.375rem + var(--department-indent));
}

@media (max-width: 639px) {
  .department-tree-row {
    padding-inline-start: min(calc(0.375rem + var(--department-indent)), 4.875rem);
  }
}
</style>
