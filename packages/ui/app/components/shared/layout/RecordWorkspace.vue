<script setup lang="ts">
import { errorStateKind } from '../../../utils/errorState'
import type { RouteLocationRaw } from 'vue-router'
import LoadingSkeleton from '../feedback/LoadingSkeleton.vue'
import PageContainer from './PageContainer.vue'
import PageHeader from './PageHeader.vue'
import PageState from '../feedback/PageState.vue'

/*
 * The record workspace (DESIGN.md §6, records inside an application): one compact header row, then a main column
 * without cards and a plain properties aside. The trail names every ancestor and ends with the record itself; the
 * title and the status chip share the row with the actions at the inline end; there are no tabs, no app tile and no
 * tagline. `meta` holds short facts after the status. The aside is first in the DOM, so a phone reads the
 * properties before the content, and wide screens place it at the inline end.
 */
interface WorkspaceTrailStep { label: string; to?: RouteLocationRaw; testId?: string }

const props = defineProps<{
  /** The record's name: the page title the shell registers and the heading's fallback. */
  title: string
  /** Every ancestor and the record itself as the last step, for example Projects › Alpha › Tasks › Write the brief. */
  trail: WorkspaceTrailStep[]
  /** Where Escape goes: the list the record was opened from. */
  backTo?: RouteLocationRaw
  loading?: boolean
  error?: unknown
  keepContent?: boolean
}>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
const preserve = computed(() => !!props.keepContent && !['forbidden', 'notFound'].includes(errorStateKind(props.error)))
const ready = computed(() => (!props.loading || preserve.value) && (!props.error || preserve.value))
// A loaded record whose name is blank still gets a heading; a loading or failed one keeps what it was given.
const heading = computed(() => (ready.value ? props.title.trim() || t('states.untitled') : props.title))
</script>

<template>
  <PageContainer data-template="record-workspace">
    <PageHeader :title="heading" compact :trail="props.trail" :back-to="props.backTo">
      <template v-if="$slots.breadcrumb" #back><slot name="breadcrumb" /></template>
      <template v-if="props.loading && !props.title" #title>
        <USkeleton class="inline-block h-6 w-48 align-middle" /><span class="sr-only">{{ t('app.loading') }}</span>
      </template>
      <template v-else-if="$slots.title" #title><slot name="title" /></template>
      <template #tags>
        <template v-if="ready">
          <slot name="status" />
          <slot name="meta" />
        </template>
      </template>
      <template v-if="ready && $slots.actions" #actions><slot name="actions" /></template>
    </PageHeader>
    <PageState v-if="props.error" :error="props.error" @retry="$emit('retry')" />
    <LoadingSkeleton v-if="props.loading && !preserve" variant="record" />
    <div v-else-if="!props.error || preserve" data-slot="record-body" class="grid gap-(--liwan-gap-card)" :class="{ 'lg:grid-cols-[minmax(0,1fr)_20rem]': $slots.aside }">
      <aside v-if="$slots.aside" data-slot="record-aside" class="min-w-0 lg:sticky lg:top-4 lg:order-last lg:self-start" :aria-label="t('states.properties')">
        <slot name="aside" />
      </aside>
      <div data-slot="record-main" class="grid min-w-0 content-start gap-6"><slot name="main" /></div>
    </div>
  </PageContainer>
</template>
