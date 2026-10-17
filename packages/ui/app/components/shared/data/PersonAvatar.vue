<script setup lang="ts">
import { avatarProps } from '../../../utils/avatarTone'

// People in a table cell or a row, avatars only. One person: a round avatar. Several: an overlapping stack of at most
// `max` avatars (the first on top, each overlapping the previous by a logical negative margin, so RTL and LTR both
// work, with a ring in the surface colour) and one round `+N` chip for the rest. A person's `src` is shown as a photo;
// without it the initials avatar takes a deterministic soft tint. The whole group is one tooltip and accessible name.
const props = withDefaults(defineProps<{ people: { id: number; name: string; src?: string }[]; max?: number }>(), { max: 3 })
const visible = computed(() => props.people.slice(0, props.max))
const rest = computed(() => props.people.length - visible.value.length)
const names = computed(() => props.people.map(person => person.name).join('، '))
</script>

<template>
  <span v-if="!people.length" class="text-muted">—</span>
  <span v-else role="img" class="inline-flex items-center" :title="names" :aria-label="names" data-testid="person-avatar">
    <span class="inline-flex items-center" data-slot="avatar-stack">
      <UAvatar
        v-for="(person, index) in visible"
        :key="person.id"
        v-bind="avatarProps(person.name, person.id)"
        :src="person.src"
        size="md"
        class="relative shrink-0"
        :class="{ '-ms-[0.571rem]': index > 0 }"
        :style="{ ...avatarProps(person.name, person.id).style, zIndex: visible.length - index }"
      />
    </span>
    <span
      v-if="rest > 0"
      class="ms-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-toned tabular-nums"
      data-slot="avatar-more"
      aria-hidden="true"
    >+{{ rest }}</span>
  </span>
</template>
