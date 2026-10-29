<script setup lang="ts">
// A product picture that falls back to a package icon when there is none or it fails to load (Meta-hosted or tokenised
// URLs can be unreachable); the caller sets the size and shape with `class`.
const props = defineProps<{ src: string | null; alt?: string }>()
const failed = ref(false)
const image = ref<HTMLImageElement | null>(null)
// An image that failed before hydration never reports it, so a finished load with no pixels is read here.
onMounted(() => { if (image.value?.complete && image.value.naturalWidth === 0) failed.value = true })
watch(() => props.src, () => { failed.value = false })
</script>

<template>
  <img v-if="props.src && !failed" ref="image" :src="props.src" :alt="props.alt ?? ''" loading="lazy" class="object-cover" @error="failed = true">
  <span v-else class="flex items-center justify-center bg-elevated text-muted" role="img" :aria-label="props.alt || undefined" :aria-hidden="props.alt ? undefined : true"><UIcon name="i-lucide-package" class="size-1/2" aria-hidden="true" /></span>
</template>
