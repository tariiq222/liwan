<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import LoadingSkeleton from '../feedback/LoadingSkeleton.vue'
import PageContainer from './PageContainer.vue'
import PageHeader from './PageHeader.vue'
import PageState from '../feedback/PageState.vue'

/*
 * The record template (Tasmim spec §6, template 2): header with back link and actions, optional
 * tabs, the main column and a properties aside. The aside sits at the inline end on wide screens
 * and after the main column on phones, so reading and focus order stay the DOM order.
 */
const props = defineProps<{
  title: string
  description?: string
  backTo?: RouteLocationRaw
  backLabel?: string
  loading?: boolean
  error?: unknown
  /** A frame around the page already shows the heading (the project workspace): draw no heading. Actions still render. */
  hideHeader?: boolean
}>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
const ready = computed(() => !props.loading && !props.error)
// A loaded record whose name is blank still gets a heading; a loading or failed one keeps what it was given.
const heading = computed(() => (ready.value ? props.title.trim() || t('states.untitled') : props.title))
</script>

<template>
  <PageContainer width="detail" data-template="record">
    <PageHeader :title="heading" :description="props.description" :back-to="props.backTo" :back-label="props.backLabel" :hide-title="props.hideHeader">
      <template v-if="props.loading && !props.title" #title>
        <USkeleton class="inline-block h-6 w-48 align-middle" /><span class="sr-only">{{ t('app.loading') }}</span>
      </template>
      <template v-if="$slots.back" #back><slot name="back" /></template>
      <template v-if="ready && $slots.actions" #actions><slot name="actions" /></template>
    </PageHeader>
    <div v-if="ready && $slots.tabs" data-slot="record-tabs"><slot name="tabs" /></div>
    <LoadingSkeleton v-if="props.loading" variant="record" />
    <PageState v-else-if="props.error" :error="props.error" @retry="$emit('retry')" />
    <div v-else data-slot="record-body" class="grid gap-6" :class="{ 'lg:grid-cols-[minmax(0,1fr)_20rem]': $slots.aside }">
      <div data-slot="record-main" class="min-w-0 space-y-6"><slot /></div>
      <aside v-if="$slots.aside" data-slot="record-aside" class="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start" :aria-label="t('states.properties')">
        <slot name="aside" />
      </aside>
    </div>
  </PageContainer>
</template>
