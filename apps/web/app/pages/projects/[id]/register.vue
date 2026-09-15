<script setup lang="ts">
import { inject } from 'vue'
import { useProjectRegister, useDeleteProjectRegister } from '@/composables/useProjectGovernance'
import { governanceFilters } from '@/composables/projectGovernanceKeys'
import { REGISTER_PRIORITY_TONE, REGISTER_STATUS_TONE, registerScoreTone } from '@/components/project/governance/state'
import { STATUS_COLOR } from '@/utils/statusTone'
import { ApiError } from '@/composables/useApi'
import FilterBar from '@/components/shared/FilterBar.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import type { RowAction } from '@/components/shared/RowActions.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const isProjectOverlay = inject<boolean>(Symbol.for('nasq.project.overlay'), false)
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/projects\/[^/]+\/register/, '')
  return rest === '' || rest === '/new'
})
const id = computed(() => Number(route.params.id))
const parsed = computed(() => governanceFilters(route.query))
const filters = computed(() => (parsed.value))
const list = useProjectRegister(computed(() => isListRoute.value ? id.value : null), filters)
const remove = useDeleteProjectRegister()
const confirmDeleteId = ref<number | null>(null)
const error = ref<string | null>(null)
function setFilter(key: string, value: string) {
  router.replace({ query: { ...route.query, [key]: value || undefined, offset: undefined } })
}
const q = computed({
  get: () => typeof route.query.q === 'string' ? route.query.q : '',
  set: value => setFilter('q', value),
})
const kind = computed({
  get: () => parsed.value.kind ?? 'all',
  set: value => setFilter('kind', value === 'all' ? '' : String(value ?? '')),
})
const status = computed({
  get: () => parsed.value.status ?? 'all',
  set: value => setFilter('status', value === 'all' ? '' : String(value ?? '')),
})
const priority = computed({
  get: () => parsed.value.priority ?? 'all',
  set: value => setFilter('priority', value === 'all' ? '' : String(value ?? '')),
})
const activeFilterCount = computed(() => Number(Boolean(q.value.trim())) + Number(Boolean(parsed.value.kind)) + Number(Boolean(parsed.value.status)) + Number(Boolean(parsed.value.priority)))
function clearFilters() {
  router.replace({ query: { ...route.query, q: undefined, kind: undefined, status: undefined, priority: undefined, offset: undefined } })
}
function page(delta: number) {
  router.push({ query: { ...route.query, offset: String(Math.max(0, (parsed.value.offset ?? 0) + delta * 50)) } })
}
const kindItems = computed(() => [
  { value: 'all', label: t('projects.clarity.allKinds') },
  { value: 'risk', label: t('projects.governance.register.risk') },
  { value: 'issue', label: t('projects.governance.register.issue') },
])
const statusItems = computed(() => [
  { value: 'all', label: t('projects.clarity.allStatuses') },
  { value: 'open', label: t('projects.governance.register.open') },
  { value: 'in_progress', label: t('projects.governance.register.inProgress') },
  { value: 'resolved', label: t('projects.governance.register.resolved') },
  { value: 'closed', label: t('projects.governance.register.closed') },
])
const priorityItems = computed(() => [
  { value: 'all', label: t('projects.clarity.allPriorities') },
  ...['low', 'normal', 'high', 'critical'].map(value => ({ value, label: t(`projects.governance.register.${value}`) })),
])
function itemLabel(items: { value: string; label: string }[], value: string) {
  return items.find(item => item.value === value)?.label ?? value
}
const columns = computed(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'title', header: t('projects.governance.register.itemTitle') },
  { accessorKey: 'kind', header: t('projects.governance.register.kind') },
  { accessorKey: 'priority', header: t('projects.governance.register.priority') },
  { accessorKey: 'status', header: t('projects.governance.register.status') },
  { accessorKey: 'score', header: t('projects.clarity.riskScore') },
  { id: 'actions', header: t('app.actions') },
])
async function deleteItem(item: { id: number }) {
  error.value = null
  if (confirmDeleteId.value !== item.id) {
    confirmDeleteId.value = item.id
    return
  }
  try {
    await remove.mutateAsync({ projectId: id.value, id: item.id })
    confirmDeleteId.value = null
  }
  catch (cause) {
    error.value = cause instanceof ApiError && cause.code === 'stakeholder_assigned'
      ? t('projects.governance.stakeholderAssigned')
      : cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}
const confirmItem = computed(() => list.data.value?.items.find(item => item.id === confirmDeleteId.value) ?? null)
// The row menu only opens the confirmation; deletion happens from SharedInlineConfirm.
function rowActions(item: { id: number; title: string }): RowAction[] {
  return [{
    label: t('projects.governance.delete'),
    icon: 'i-lucide-trash-2',
    destructive: true,
    disabled: remove.isPending.value,
    onSelect: () => {
      if (confirmDeleteId.value === item.id) return
      void deleteItem(item)
      void nextTick(() => document.querySelector('[data-testid="register-delete-confirm"]')?.scrollIntoView({ block: 'nearest' }))
    },
  }]
}
function cancelDelete() {
  confirmDeleteId.value = null
  error.value = null
}
</script>

<template>
  <SharedPageContainer v-if="isListRoute" width="list">
    <SharedPageHeader
      v-if="!isProjectOverlay"
      :title="t('projects.refresh.workspace.registerTitle')"
    >
      <template #actions>
        <UButton
          v-if="list.data.value?.can_manage && hydrated"
          data-testid="register-create"
          icon="i-lucide-plus"
          :to="`/projects/${id}/register/new`"
        >
          {{ t('projects.clarity.addRegister') }}
        </UButton>
      </template>
    </SharedPageHeader>
    <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
      <template #search>
        <UInput
          v-model="q"
          :aria-label="t('projects.clarity.registerSearch')"
          :disabled="!hydrated"
          :placeholder="t('projects.clarity.registerSearch')"
          icon="i-lucide-search"
          class="w-full min-w-52"
        />
      </template>
      <template #default>
        <SharedFilterChoice
          layout="segment"
          :label="t('projects.governance.register.kind')"
          :items="kindItems"
          :model-value="kind"
          :disabled="!hydrated"
          @update:model-value="kind = String($event)"
        />
        <SharedFilterChoice
          :label="t('projects.governance.register.status')"
          :items="statusItems"
          :model-value="status"
          :disabled="!hydrated"
          @update:model-value="status = String($event)"
        />
        <SharedFilterChoice
          :label="t('projects.governance.register.priority')"
          :items="priorityItems"
          :model-value="priority"
          :disabled="!hydrated"
          @update:model-value="priority = String($event)"
        />
      </template>
      <template #active>
        <div v-if="activeFilterCount" class="flex flex-wrap items-center gap-2">
          <SharedFilterChip v-if="q.trim()" :label="`${t('projects.clarity.registerSearch')}: ${q}`" @remove="q = ''" />
          <SharedFilterChip v-if="parsed.kind" :label="itemLabel(kindItems, kind)" @remove="kind = 'all'" />
          <SharedFilterChip v-if="parsed.status" :label="itemLabel(statusItems, status)" @remove="status = 'all'" />
          <SharedFilterChip v-if="parsed.priority" :label="itemLabel(priorityItems, priority)" @remove="priority = 'all'" />
        </div>
      </template>
    </FilterBar>
    <SharedInlineConfirm
      v-if="confirmItem"
      data-testid="register-delete-confirm"
      :title="t('projects.governance.confirmDeleteNamed', { name: confirmItem.title })"
      :confirm-label="t('projects.governance.confirmDeleteAction')"
      :pending="remove.isPending.value"
      @cancel="cancelDelete"
      @confirm="deleteItem(confirmItem)"
    >
      <p v-if="error" class="text-error">{{ error }}</p>
    </SharedInlineConfirm>
    <p v-else-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <SharedPageState
      :loading="list.isLoading.value"
      :error="list.error.value"
      :empty="!list.isLoading.value && !list.data.value?.items.length"
      :empty-text="t(activeFilterCount ? 'projects.clarity.filteredEmpty' : 'projects.clarity.registerEmpty')"
      @retry="list.refetch"
    />
    <section v-if="list.data?.value?.items.length" class="rounded-lg ring ring-default bg-default overflow-hidden" :aria-label="t('projects.refresh.workspace.registerTitle')">
      <div class="hidden overflow-x-auto md:block">
        <UTable :data="list.data.value.items" :columns="columns">
          <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
          <template #title-cell="{ row }">
            <NuxtLink
              class="font-medium underline"
              :to="`/projects/${id}/register/${row.original.id}`"
            >
              {{ row.original.title }}
            </NuxtLink>
          </template>
          <template #kind-cell="{ row }">{{ t(`projects.governance.register.${row.original.kind}`) }}</template>
          <template #priority-cell="{ row }"><UBadge variant="subtle" :color="STATUS_COLOR[REGISTER_PRIORITY_TONE[row.original.priority]]">{{ t(`projects.governance.register.${row.original.priority}`) }}</UBadge></template>
          <template #status-cell="{ row }"><UBadge variant="subtle" :color="STATUS_COLOR[REGISTER_STATUS_TONE[row.original.status]]">{{ t(`projects.governance.register.${row.original.status}`) }}</UBadge></template>
          <template #score-cell="{ row }"><UBadge variant="subtle" :color="STATUS_COLOR[registerScoreTone(row.original.score)]">{{ row.original.score ?? '—' }}</UBadge></template>
          <template #actions-cell="{ row }">
            <div v-if="list.data.value?.can_manage" class="flex justify-end">
              <SharedRowActions :actions="rowActions(row.original)" :label="t('projects.governance.actionsNamed', { name: row.original.title })" :disabled="!hydrated" />
            </div>
          </template>
        </UTable>
      </div>
      <ul class="grid gap-3 p-3 md:hidden" :aria-label="t('projects.refresh.workspace.registerTitle')">
        <li v-for="item in list.data.value.items" :key="`mobile-register-${item.id}`">
          <UCard>
            <div class="space-y-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <RecordNumber :value="item.id" />
                  <NuxtLink
                    class="block font-medium underline"
                    :to="`/projects/${id}/register/${item.id}`"
                  >
                    {{ item.title }}
                  </NuxtLink>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <UBadge variant="subtle" :color="STATUS_COLOR[REGISTER_STATUS_TONE[item.status]]">{{ t(`projects.governance.register.${item.status}`) }}</UBadge>
                  <SharedRowActions v-if="list.data.value?.can_manage" :actions="rowActions(item)" :label="t('projects.governance.actionsNamed', { name: item.title })" :disabled="!hydrated" />
                </div>
              </div>
              <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt class="text-xs text-muted">{{ t('projects.governance.register.kind') }}</dt>
                  <dd>{{ t(`projects.governance.register.${item.kind}`) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted">{{ t('projects.governance.register.priority') }}</dt>
                  <dd><UBadge variant="subtle" :color="STATUS_COLOR[REGISTER_PRIORITY_TONE[item.priority]]">{{ t(`projects.governance.register.${item.priority}`) }}</UBadge></dd>
                </div>
                <div>
                  <dt class="text-xs text-muted">{{ t('projects.clarity.riskScore') }}</dt>
                  <dd><UBadge variant="subtle" :color="STATUS_COLOR[registerScoreTone(item.score)]">{{ item.score ?? '—' }}</UBadge></dd>
                </div>
              </dl>
            </div>
          </UCard>
        </li>
      </ul>
    </section>
    <nav v-if="list.data.value && (list.data.value.total > 50 || parsed.offset)" class="flex items-center gap-3" :aria-label="t('projects.governance.pagination')">
      <UButton color="neutral" variant="ghost" :disabled="!hydrated || list.isFetching.value || !parsed.offset" :label="t('projects.governance.previous')" @click="page(-1)" />
      <span>{{ t('projects.governance.total', { total: list.data.value.total }) }}</span>
      <UButton color="neutral" variant="ghost" :disabled="!hydrated || list.isFetching.value || (parsed.offset ?? 0) + 50 >= list.data.value.total" :label="t('projects.governance.next')" @click="page(1)" />
    </nav>
  </SharedPageContainer>
  <NuxtPage />
</template>
