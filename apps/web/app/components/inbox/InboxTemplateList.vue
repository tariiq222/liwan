<script setup lang="ts">
import { TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_TONE, TEMPLATE_QUALITY_TONE, TEMPLATE_STATUSES, TEMPLATE_STATUS_TONE } from '@/composables/inbox/inboxTemplate'
import { useInboxChannelTemplates } from '@/composables/inbox/useInboxSettings'

// The templates of one channel with their review status, category and quality, filtered by status, category and a name
// search kept in the address (`?status=&category=&q=`), so a filtered list can be shared and survives refresh and back.
const props = defineProps<{ channelId: number }>()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const ALL = 'all'
const pick = (key: string, allowed: readonly string[]) => {
  const value = route.query[key]
  return typeof value === 'string' && allowed.includes(value) ? value : ''
}
const status = computed(() => pick('status', TEMPLATE_STATUSES))
const category = computed(() => pick('category', TEMPLATE_CATEGORIES))
const committedSearch = computed(() => typeof route.query.q === 'string' ? route.query.q : '')
const search = ref(committedSearch.value)
watch(committedSearch, (value) => { search.value = value })

const query = useInboxChannelTemplates(() => props.channelId, () => ({ status: status.value, category: category.value, q: committedSearch.value.trim(), limit: 200 }))
const items = computed(() => query.data.value?.items ?? [])
const filtered = computed(() => !!(status.value || category.value || committedSearch.value.trim()))

function update(values: Record<string, string | undefined>) {
  if (!hydrated.value) return
  void router.replace({ path: route.path, query: { ...route.query, ...values } })
}
const withAll = (values: readonly string[], key: string) => [
  { value: ALL, label: t(`inbox.templates.filter.all.${key}`) },
  ...values.map(value => ({ value, label: t(`inbox.templates.${key}.${value}`) })),
]
const statusItems = computed(() => withAll(TEMPLATE_STATUSES, 'status'))
const categoryItems = computed(() => withAll(TEMPLATE_CATEGORIES, 'category'))
const onSelect = (key: 'status' | 'category', value: string) => update({ [key]: value === ALL ? undefined : value })
function clear() {
  search.value = ''
  update({ status: undefined, category: undefined, q: undefined })
}
</script>

<template>
  <SharedRecordSection id="templates" variant="list" :title="t('inbox.templates.title')" :description="t('inbox.templates.hint')">
    <template #actions>
      <UButton v-if="can('inbox.templates.manage')" :to="{ path: `/settings/apps/inbox/channels/${props.channelId}/templates/new` }" icon="i-lucide-plus" :disabled="!hydrated" :label="t('inbox.templates.create')" data-testid="inbox-template-create" />
    </template>
    <div class="px-(--webvue-card-pad) py-3">
      <SharedFilterBar embedded class="w-full" :active-count="Number(!!status) + Number(!!category) + Number(!!committedSearch.trim())" :disabled="!hydrated" @clear="clear">
        <template #search>
          <form @submit.prevent="update({ q: search.trim() || undefined })">
            <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('inbox.templates.filter.search')" :aria-label="t('inbox.templates.filter.search')" :disabled="!hydrated" data-testid="inbox-template-search" @blur="update({ q: search.trim() || undefined })" />
          </form>
        </template>
        <USelect :model-value="status || ALL" :items="statusItems" :aria-label="t('inbox.templates.filter.status')" :disabled="!hydrated" data-testid="inbox-template-filter-status" @update:model-value="onSelect('status', $event)" />
        <USelect :model-value="category || ALL" :items="categoryItems" :aria-label="t('inbox.templates.filter.category')" :disabled="!hydrated" data-testid="inbox-template-filter-category" @update:model-value="onSelect('category', $event)" />
      </SharedFilterBar>
    </div>
    <SharedLoadingSkeleton v-if="query.isPending.value" class="m-4" />
    <SharedPageState v-else-if="query.error.value" class="m-4" :error="query.error.value" @retry="query.refetch()" />
    <p v-else-if="!items.length" class="px-(--webvue-card-pad) py-4 text-sm text-muted" data-testid="inbox-templates-empty">{{ filtered ? t('app.noResults') : t('inbox.templates.empty') }}</p>
    <template v-else>
      <NuxtLink
        v-for="template in items"
        :key="template.id"
        :to="{ path: `/settings/apps/inbox/channels/${props.channelId}/templates/${template.id}`, query: route.query }"
        class="flex flex-col gap-1.5 px-(--webvue-card-pad) py-3 text-start transition-colors duration-150 hover:bg-(--webvue-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
        :data-testid="`inbox-template-${template.id}`"
      >
        <span class="flex flex-wrap items-center justify-between gap-3">
          <span class="flex min-w-0 items-center gap-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UIcon name="i-lucide-file-text" class="size-5" aria-hidden="true" /></span>
            <span class="min-w-0">
              <bdi dir="ltr" class="block truncate text-sm font-medium text-highlighted">{{ template.name }}</bdi>
              <span class="block truncate text-xs text-muted"><bdi dir="ltr">{{ template.language }}</bdi> · {{ template.body }}</span>
            </span>
          </span>
          <span class="flex flex-wrap items-center gap-2">
            <SharedStatusBadge v-if="!template.supported" size="sm" tone="neutral" :label="t('inbox.templates.unsupported')" data-testid="inbox-template-unsupported-badge" />
            <SharedStatusBadge size="sm" :tone="TEMPLATE_CATEGORY_TONE[template.category]" :label="t(`inbox.templates.category.${template.category}`)" data-testid="inbox-template-category-badge" />
            <SharedStatusBadge size="sm" :tone="TEMPLATE_STATUS_TONE[template.status]" :label="t(`inbox.templates.status.${template.status}`)" data-testid="inbox-template-status-badge" />
            <SharedStatusBadge v-if="template.quality !== 'unknown'" size="sm" :tone="TEMPLATE_QUALITY_TONE[template.quality]" :label="t(`inbox.templates.quality.${template.quality}`)" data-testid="inbox-template-quality-badge" />
            <UIcon name="i-lucide-chevron-right" class="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
          </span>
        </span>
        <span v-if="template.status_reason" class="ps-12 text-xs text-error" :data-testid="`inbox-template-reason-${template.id}`">{{ t('inbox.templates.reason') }}: <bdi>{{ template.status_reason }}</bdi></span>
      </NuxtLink>
    </template>
  </SharedRecordSection>
</template>
