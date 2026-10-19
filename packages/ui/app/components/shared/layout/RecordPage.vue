<script setup lang="ts">
import { errorStateKind } from '../../../utils/errorState'
import type { RouteLocationRaw } from 'vue-router'
import LoadingSkeleton from '../feedback/LoadingSkeleton.vue'
import PageContainer from './PageContainer.vue'
import PageHeader from './PageHeader.vue'
import type { PageHeaderTag } from '../../../utils/pageHeaderTag'
import PageState from '../feedback/PageState.vue'

/*
 * The record template (Tasmim spec §6, template 2): header with back link and actions, optional
 * operational summary, tabs, the main column and an optional supporting aside. The aside sits at the inline end on wide screens
 * and after the main column on phones, so reading and focus order stay the DOM order.
 */
const props = withDefaults(defineProps<{
  title: string
  description?: string
  tags?: PageHeaderTag[]
  backTo?: RouteLocationRaw
  backLabel?: string
  loading?: boolean
  error?: unknown
  keepContent?: boolean
  /** A frame around the page already shows the heading (the project workspace): draw no heading. Actions still render. */
  hideHeader?: boolean
  /** `full` lets a record page that is a dashboard of cards (the project overview) use the whole workspace width. */
  width?: 'detail' | 'full'
}>(), { width: 'detail' })
defineEmits<{ retry: [] }>()
const { t } = useI18n()
const preserve = computed(() => !!props.keepContent && !['forbidden', 'notFound'].includes(errorStateKind(props.error)))
const ready = computed(() => (!props.loading || preserve.value) && (!props.error || preserve.value))
// A loaded record whose name is blank still gets a heading; a loading or failed one keeps what it was given.
const heading = computed(() => (ready.value ? props.title.trim() || t('states.untitled') : props.title))
</script>

<template>
  <PageContainer :width="props.width" data-template="record">
    <PageHeader :title="heading" :description="props.description" :tags="props.tags" :back-to="props.backTo" :back-label="props.backLabel" :hide-title="props.hideHeader">
      <template v-if="props.loading && !props.title" #title>
        <USkeleton class="inline-block h-6 w-48 align-middle" /><span class="sr-only">{{ t('app.loading') }}</span>
      </template>
      <template v-if="$slots.back" #back><slot name="back" /></template>
      <template v-if="$slots.tags" #tags><slot name="tags" /></template>
      <template v-if="ready && $slots.actions" #actions><slot name="actions" /></template>
    </PageHeader>
    <div v-if="ready && $slots.summary" data-slot="record-summary" class="min-w-0"><slot name="summary" /></div>
    <div v-if="ready && $slots.tabs" data-slot="record-tabs"><slot name="tabs" /></div>
    <PageState v-if="props.error" :error="props.error" @retry="$emit('retry')" />
    <LoadingSkeleton v-if="props.loading && !preserve" variant="record" />
    <div v-else-if="!props.error || preserve" data-slot="record-body" class="grid gap-(--webvue-gap-card)" :class="{ 'lg:grid-cols-[minmax(0,1fr)_20rem]': $slots.aside }">
      <div data-slot="record-main" class="grid min-w-0 content-start gap-(--webvue-gap-card)"><slot /></div>
      <aside v-if="$slots.aside" data-slot="record-aside" class="grid min-w-0 gap-(--webvue-gap-card) lg:sticky lg:top-4 lg:self-start" :aria-label="t('states.properties')">
        <slot name="aside" />
      </aside>
    </div>
  </PageContainer>
</template>
