<script setup lang="ts">
import type { ServiceGroup } from '@/composables/nav/servicesStartModel'

// The user's self-service entries, one titled section per application; each entry is a link card.
const props = defineProps<{ groups: ServiceGroup[] }>()
const { t } = useI18n()
const headingId = (id: string) => `services-group-${id}`
</script>

<template>
  <div class="space-y-6" data-testid="services-groups">
    <section v-for="group in props.groups" :key="group.id" :aria-labelledby="headingId(group.id)" class="space-y-3" data-testid="services-group">
      <h2 :id="headingId(group.id)" class="flex items-center gap-2 text-sm font-semibold text-muted">
        <UIcon :name="group.icon" class="size-4" aria-hidden="true" />
        {{ t(group.labelKey) }}
      </h2>
      <div class="grid gap-(--webvue-gap-card) sm:grid-cols-2 xl:grid-cols-3">
        <SharedLinkCard v-for="entry in group.entries" :key="entry.id" :to="entry.to" :icon="entry.icon" :title="t(entry.labelKey)" :description="t(entry.descriptionKey)" data-testid="service-entry" />
      </div>
    </section>
  </div>
</template>
