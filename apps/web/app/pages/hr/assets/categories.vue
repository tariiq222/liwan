<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { HrRef } from '@webvue/contracts'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()

// The category catalog is this page's own screen and stays behind its create panel.
const isListRoute = computed(() => {
  const path = route.path.replace(/\/+$/, '') || '/'
  return path === '/hr/assets/categories' || path === '/hr/assets/categories/new'
})
const canManage = computed(() => can('hr.assets.manage'))
const categories = useHrAssetCategories()

const items = computed(() => categories.data.value?.items ?? [])
const columns = computed<TableColumn<HrRef>[]>(() => [
  { accessorKey: 'name', header: t('hrAssets.categories.columns.name') },
])
const showEmpty = computed(() => !categories.isLoading.value && !categories.error.value && !items.value.length)

const backTo = computed(() => ({ path: '/hr/assets' }))
const createTo = computed(() => canManage.value ? { path: '/hr/assets/categories/new' } : undefined)
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    :title="t('hrAssets.categories.title')"
    :back-to="backTo"
    :back-label="t('nav.assets')"
    :create-to="createTo"
    :create-label="t('hrAssets.categories.new')"
    create-test-id="hr-asset-category-new"
  >
    <SharedListCard>
      <SharedPageState :error="categories.error.value" :keep-content="items.length > 0" @retry="categories.refetch">
        <SharedEmptyState
          v-if="showEmpty"
          class="m-(--webvue-card-pad-dense)"
          :title="t('hrAssets.categories.emptyTitle')"
          :description="t('hrAssets.categories.emptyHint')"
        />
        <SharedDataTable
          v-else
          bare
          :rows="items"
          :columns="columns"
          row-key="id"
          :loading="categories.isLoading.value"
          :caption="t('hrAssets.categories.title')"
        >
          <template #name-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.name }}</span></template>
          <template #mobile-row="{ row }"><p class="font-semibold text-highlighted">{{ row.name }}</p></template>
        </SharedDataTable>
      </SharedPageState>
      <template v-if="categories.data.value && !showEmpty" #footer>
        <SharedListFooter
          :count-label="t('hrAssets.categories.footer', { shown: items.length, total: items.length }, items.length)"
          :page="1"
          :pages="1"
          :disabled="categories.isFetching.value"
          count-test-id="hr-asset-categories-count"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
