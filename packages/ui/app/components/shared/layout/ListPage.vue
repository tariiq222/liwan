<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { currentListView, listViewQuery, LIST_VIEW_KEY, type ListViewOption } from '../../../utils/listView'
import PageContainer from './PageContainer.vue'
import PageHeader from './PageHeader.vue'
import ViewSwitch from '../data/ViewSwitch.vue'

/*
 * The list template (Tasmim spec §6, template 1): heading, the page's own create button, filters,
 * a view switch bound to the route query `view`, and the list. The create button carries
 * data-shortcut-create, so `C` presses it; the search inside the caller's SharedFilterBar carries
 * data-shortcut-search, so `/` focuses it. On a ListPage, filters go in its #filters slot, not in
 * the DataTable's own. With `viewsInFilters` the switch is drawn by the embedded SharedFilterBar (card header) instead. `hideHeader` is for a page inside a frame that already owns the heading
 * (the project workspace): no heading is drawn, the create button and the actions still are.
 */
const props = defineProps<{
  title: string
  description?: string
  createTo?: RouteLocationRaw
  createLabel?: string
  /** The create button's data-testid, for pages whose e2e already name it. */
  createTestId?: string
  views?: ListViewOption[]
  /** The view switch is drawn by the embedded SharedFilterBar in the card header, not in a row above the list. */
  viewsInFilters?: boolean
  hideHeader?: boolean
  /** A link back to the page this list was opened from (the archive's back link). */
  backTo?: RouteLocationRaw
  backLabel?: string
}>()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const view = computed(() => (props.views?.length ? currentListView(route.query.view, props.views) : undefined))

function setView(value: string) {
  if (!props.views?.length || value === view.value) return
  void router.replace({ query: listViewQuery(route.query, value, props.views) })
}
if (props.viewsInFilters && props.views?.length) provide(LIST_VIEW_KEY, { view, options: props.views, setView })
</script>

<template>
  <PageContainer width="list" data-template="list">
    <PageHeader :title="props.title" :description="props.description" :back-to="props.backTo" :back-label="props.backLabel" :hide-title="props.hideHeader">
      <template v-if="props.createTo || $slots.actions" #actions>
        <UButton
          v-if="props.createTo"
          :to="props.createTo"
          icon="i-lucide-plus"
          data-shortcut-create
          :data-testid="props.createTestId"
          aria-keyshortcuts="c"
          :disabled="!hydrated"
        >{{ props.createLabel ?? t('app.create') }}</UButton>
        <slot name="actions" />
      </template>
    </PageHeader>
    <div v-if="$slots.filters || (view && !props.viewsInFilters)" data-slot="list-page-toolbar" class="flex min-w-0 flex-wrap items-start gap-3">
      <div v-if="$slots.filters" class="min-w-0 flex-1"><slot name="filters" /></div>
      <ViewSwitch v-if="view && props.views && !props.viewsInFilters" class="ms-auto" :model-value="view" :options="props.views" @update:model-value="setView" />
    </div>
    <slot :view="view" />
  </PageContainer>
</template>
