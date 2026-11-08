<script setup lang="ts">
import type { PageHeaderTag, PageHeaderTagKind } from '../../../utils/pageHeaderTag'

// The tag pills drawn after a heading's title (PageHeader, the project workspace card). A tag with `to` is a link.
const props = defineProps<{ tags?: PageHeaderTag[] }>()

// A state keeps its status colour (`tone`); a plain fact takes the fixed colour of its kind, the same on
// every page, so a person, a project or a count always reads alike.
const TAG_KIND_ACCENT: Record<PageHeaderTagKind, string> = {
  person: 'sky',
  project: 'blue',
  schedule: 'violet',
  count: 'indigo',
  category: 'amber',
}
// Tags take their radius from the badge recipe.
function tagLook(tag: PageHeaderTag) {
  if (tag.tone) return { color: tag.tone, variant: 'subtle' as const }
  if (!tag.kind) return { color: 'neutral' as const, variant: 'subtle' as const }
  const hue = TAG_KIND_ACCENT[tag.kind]
  return { color: 'neutral' as const, variant: 'soft' as const, style: { backgroundColor: `var(--accent-${hue}-bg)`, color: `var(--accent-${hue}-fg)` } }
}
</script>

<template>
  <template v-for="tag in props.tags" :key="tag.label">
    <NuxtLink v-if="tag.to" :to="tag.to" class="rounded-tag focus-visible:ring-2 focus-visible:ring-primary">
      <UBadge v-bind="tagLook(tag)" size="md" :icon="tag.icon" :data-testid="tag.testId">{{ tag.label }}</UBadge>
    </NuxtLink>
    <UBadge v-else v-bind="tagLook(tag)" size="md" :icon="tag.icon" :data-testid="tag.testId">{{ tag.label }}</UBadge>
  </template>
</template>
