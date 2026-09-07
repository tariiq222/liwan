<script setup lang="ts">
import { Plus, Search } from '@lucide/vue'
import { useProjectRegister, useDeleteProjectRegister } from '@/composables/useProjectGovernance'
import { governanceFilters } from '@/components/project/governance/state'
import { ApiError } from '@/composables/useApi'
import FilterBar from '@/components/shared/FilterBar.vue'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const parsed = computed(() => governanceFilters(route.query))
const filters = computed(() => (parsed.value))
const list = useProjectRegister(id, filters)
const remove = useDeleteProjectRegister()
const confirmDeleteId = ref<number | null>(null)
const error = ref<string | null>(null)
const returnTo = computed(() => route.fullPath)
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, `/projects/${id.value}`, ['/projects']))
function setFilter(key: string, value: string) {
  router.replace({ query: { ...route.query, [key]: value || undefined, offset: undefined } })
}
const q = computed({
  get: () => typeof route.query.q === 'string' ? route.query.q : '',
  set: value => setFilter('q', value),
})
const kind = computed({
  get: () => parsed.value.kind ?? '',
  set: value => setFilter('kind', String(value ?? '')),
})
const status = computed({
  get: () => parsed.value.status ?? '',
  set: value => setFilter('status', String(value ?? '')),
})
const priority = computed({
  get: () => parsed.value.priority ?? '',
  set: value => setFilter('priority', String(value ?? '')),
})
function page(delta: number) {
  router.push({ query: { ...route.query, offset: String(Math.max(0, (parsed.value.offset ?? 0) + delta * 50)) } })
}
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
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader
      :title="t('projects.governance.register.title')"
      :back-to="projectReturnTo"
      :back-label="t('projects.backToProject')"
    >
      <template #actions>
        <NuxtLink
          v-if="list.data.value?.can_manage && hydrated"
          :to="{ path: `/projects/${id}/register/new`, query: { returnTo } }"
        >
          <Button class="gap-2" data-testid="register-create">
            <Plus class="size-[18px]" />{{ t('app.create') }}
          </Button>
        </NuxtLink>
      </template>
    </SharedPageHeader>
    <div class="nasq-toolbar">
      <FilterBar class="w-full">
        <template #search>
          <div class="relative min-w-52 flex-1">
            <Search class="pointer-events-none absolute start-2 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input
              v-model="q"
              :aria-label="t('app.search')"
              :disabled="!hydrated"
              class="ps-8"
              :placeholder="t('app.search')"
            />
          </div>
        </template>
        <NativeSelect
          v-model="kind"
          class="h-[40px] w-40"
          :aria-label="t('projects.governance.register.kind')"
          :disabled="!hydrated"
        >
          <NativeSelectOption value="">{{ t('projects.governance.all') }}</NativeSelectOption>
          <NativeSelectOption value="risk">{{ t('projects.governance.register.risk') }}</NativeSelectOption>
          <NativeSelectOption value="issue">{{ t('projects.governance.register.issue') }}</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          v-model="status"
          class="h-[40px] w-40"
          :aria-label="t('projects.governance.register.status')"
          :disabled="!hydrated"
        >
          <NativeSelectOption value="">{{ t('projects.governance.all') }}</NativeSelectOption>
          <NativeSelectOption value="open">{{ t('projects.governance.register.open') }}</NativeSelectOption>
          <NativeSelectOption value="in_progress">{{ t('projects.governance.register.inProgress') }}</NativeSelectOption>
          <NativeSelectOption value="resolved">{{ t('projects.governance.register.resolved') }}</NativeSelectOption>
          <NativeSelectOption value="closed">{{ t('projects.governance.register.closed') }}</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          v-model="priority"
          class="h-[40px] w-40"
          :aria-label="t('projects.governance.register.priority')"
          :disabled="!hydrated"
        >
          <NativeSelectOption value="">{{ t('projects.governance.all') }}</NativeSelectOption>
          <NativeSelectOption v-for="value in ['low', 'normal', 'high', 'critical']" :key="value" :value="value">
            {{ t(`projects.governance.register.${value}`) }}
          </NativeSelectOption>
        </NativeSelect>
      </FilterBar>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <SharedPageState
      :loading="list.isLoading.value"
      :error="list.error.value"
      :empty="!list.isLoading.value && !list.data.value?.items.length"
      @retry="list.refetch"
    />
    <section v-if="list.data?.value?.items.length" class="nasq-panel overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="text-start">{{ t('projects.governance.register.itemTitle') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.governance.register.kind') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.governance.register.priority') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.governance.register.status') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.governance.register.score') }}</TableHead>
            <TableHead class="text-end" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="item in list.data.value.items" :key="item.id">
            <TableCell class="whitespace-normal">
              <NuxtLink
                class="font-medium underline"
                :to="{ path: `/projects/${id}/register/${item.id}`, query: { returnTo } }"
              >
                {{ item.title }}
              </NuxtLink>
            </TableCell>
            <TableCell>{{ t(`projects.governance.register.${item.kind}`) }}</TableCell>
            <TableCell>{{ t(`projects.governance.register.${item.priority}`) }}</TableCell>
            <TableCell>{{ t(`projects.governance.register.${item.status}`) }}</TableCell>
            <TableCell>{{ item.score ?? '—' }}</TableCell>
            <TableCell v-if="list.data.value.can_manage" class="text-end">
              <Button
                variant="ghost"
                size="sm"
                :disabled="!hydrated || remove.isPending.value"
                @click="deleteItem(item)"
              >
                {{ confirmDeleteId === item.id ? t('projects.governance.confirmDeleteAction') : t('projects.governance.delete') }}
              </Button>
              <Button
                v-if="confirmDeleteId === item.id"
                variant="outline"
                size="sm"
                :disabled="!hydrated || remove.isPending.value"
                @click="confirmDeleteId = null"
              >
                {{ t('app.cancel') }}
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </section>
    <nav v-if="list.data.value" class="flex items-center gap-3" :aria-label="t('projects.governance.pagination')">
      <Button variant="outline" :disabled="!hydrated || list.isFetching.value || !parsed.offset" @click="page(-1)">
        {{ t('projects.governance.previous') }}
      </Button>
      <span>{{ t('projects.governance.total', { total: list.data.value.total }) }}</span>
      <Button
        variant="outline"
        :disabled="!hydrated || list.isFetching.value || (parsed.offset ?? 0) + 50 >= list.data.value.total"
        @click="page(1)"
      >
        {{ t('projects.governance.next') }}
      </Button>
    </nav>
  </SharedPageContainer>
</template>
