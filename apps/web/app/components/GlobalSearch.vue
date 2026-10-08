<script setup lang="ts">
import { refDebounced, useEventListener } from '@vueuse/core'
import { returnToQuery } from '@/utils/safeReturnTo'
import { useNav } from '@/composables/nav/shellModules'
import { useAppSearch } from '@/composables/useAppSearch'

const { t, localeProperties } = useI18n()
const { me } = useMe()
const { can } = useAccess()
const { $api } = useApi()
const route = useRoute()
const hydrated = useHydrated()
const open = ref(false)
const query = ref('')
const trimmed = computed(() => query.value.trim())
const debounced = refDebounced(trimmed, 200)
function navLabel(item: ReturnType<typeof useNav>[number]) {
  return item.to === '/projects/settings' ? t('nav.projectSettings') : t(item.labelKey)
}
const nav = computed(() => useNav(me.value).filter(item => navLabel(item).toLocaleLowerCase().includes(trimmed.value.toLocaleLowerCase())))
const sections = useAppSearch({ surface: 'dialog', term: trimmed, debounced, gate: open, requireTerm: true, can, api: $api })
const noResults = computed(() => !nav.value.length && sections.every(section => !section.rows.value.length)
  && (!trimmed.value || sections.every(section => !section.waiting.value && !section.error.value)))
watch(() => route.fullPath, () => { open.value = false })
watch(open, value => { if (value) query.value = '' })
useEventListener('keydown', (event: KeyboardEvent) => {
  if (hydrated.value && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    open.value = !open.value
  }
})
function focusSearch() {
  document.getElementById('global-search-input')?.focus()
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('app.search')"
    :description="t('search.description')"
    :ui="{ content: 'nasq-search-dialog max-w-2xl max-h-[min(620px,calc(100dvh-2rem))] gap-0 divide-y-0 overflow-hidden rounded-xl p-0', overlay: 'nasq-search-overlay' }"
    @after:enter="focusSearch"
  >
    <UButton :aria-label="t('app.search')" color="neutral" variant="outline" class="nasq-search-trigger" :disabled="!hydrated">
      <span class="flex min-w-0 items-center gap-2">
        <UIcon name="i-lucide-search" class="size-4 shrink-0" aria-hidden="true" />
        <span data-slot="label" class="nasq-search-trigger-label truncate">{{ t('app.search') }}</span>
      </span>
      <UKbd dir="ltr">⌘K</UKbd>
    </UButton>
    <template #content="{ close }">
      <div :dir="localeProperties.dir" class="flex max-h-[min(620px,calc(100dvh-2rem))] w-full flex-col overflow-hidden">
        <div class="flex min-h-16 shrink-0 items-center gap-2.5 border-b border-default px-3 py-2.5">
          <UIcon name="i-lucide-search" class="size-4.5 shrink-0 text-muted" aria-hidden="true" />
          <UInput
            id="global-search-input"
            v-model="query"
            :aria-label="t('app.search')"
            :placeholder="t('search.description')"
            class="min-w-0 flex-1"
            autocomplete="off"
            variant="none"
          />
          <UButton color="neutral" variant="ghost" square class="shrink-0 text-muted" :aria-label="t('search.close')" @click="close">
            <template #leading>
              <UIcon name="i-lucide-x" class="size-4.5" aria-hidden="true" />
            </template>
          </UButton>
        </div>

        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3" aria-live="polite">
          <section v-if="nav.length">
            <h2 class="mb-1.5 flex items-center gap-1.5 px-2 text-xs font-semibold text-muted">
              <span>{{ t('nav.goTo') }}</span>
              <UBadge color="neutral" variant="subtle" size="sm" aria-hidden="true">{{ nav.length }}</UBadge>
            </h2>
            <div class="grid gap-1" :class="{ 'sm:grid-cols-2': !trimmed }">
              <template v-for="item in nav" :key="item.to">
                <UButton
                  v-if="item.to === '/odoo'"
                  :href="item.to"
                  target="_blank"
                  rel="noopener"
                  color="neutral"
                  variant="ghost"
                  class="min-h-11 min-w-0 justify-start"
                  :title="navLabel(item)"
                  :label="navLabel(item)"
                  @click="open = false"
                >
                  <template #leading>
                    <UIcon :name="item.icon" class="size-4 shrink-0 text-muted" aria-hidden="true" />
                  </template>
                </UButton>
                <UButton
                  v-else
                  :to="item.to"
                  color="neutral"
                  variant="ghost"
                  class="min-h-11 min-w-0 justify-start"
                  :title="navLabel(item)"
                  :label="navLabel(item)"
                  @click="open = false"
                >
                  <template #leading>
                    <UIcon :name="item.icon" class="size-4 shrink-0 text-muted" aria-hidden="true" />
                  </template>
                </UButton>
              </template>
            </div>
          </section>

          <template v-for="section in sections" :key="section.provider.id">
            <section v-if="trimmed && section.visible.value && (section.rows.value.length || section.waiting.value || section.error.value)" class="grid gap-1">
              <h2 class="mb-0.5 flex items-center gap-1.5 px-2 text-xs font-semibold text-muted">
                <span>{{ t(section.provider.labelKey) }}</span>
                <UBadge color="neutral" variant="subtle" size="sm" aria-hidden="true">{{ section.rows.value.length }}</UBadge>
              </h2>
              <p v-if="section.truncated.value && section.provider.truncatedKey" class="px-2 text-xs text-muted" role="status">{{ t(section.provider.truncatedKey) }}</p>
              <SharedPageState :loading="section.waiting.value" :error="section.error.value" @retry="section.refetch()" />
              <UButton
                v-for="row in section.rows.value"
                :key="row.id"
                :to="{ path: row.to, query: returnToQuery(route.fullPath) }"
                color="neutral"
                variant="ghost"
                class="min-h-11 min-w-0 justify-start"
                :title="row.label"
                :label="row.label"
                @click="open = false"
              >
                <template #leading>
                  <UIcon :name="section.provider.icon" class="size-4 shrink-0 text-muted" aria-hidden="true" />
                </template>
              </UButton>
              <UButton
                v-if="section.hasNext.value"
                color="neutral"
                variant="outline"
                block
                class="mt-1.5"
                :disabled="section.fetchingNext.value"
                :label="t('app.loadMore')"
                @click="section.fetchNext()"
              />
            </section>
          </template>

          <p v-if="noResults" class="px-4 py-10 text-center text-base text-muted">{{ t('app.noResults') }}</p>
        </div>
      </div>
    </template>
  </UModal>
</template>
