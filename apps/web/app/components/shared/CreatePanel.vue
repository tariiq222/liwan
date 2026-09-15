<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

const props = withDefaults(defineProps<{
  title: string
  backTo: RouteLocationRaw
  description?: string
  width?: 'form' | 'wide'
}>(), {
  width: 'form',
})

const { t, localeProperties } = useI18n()
const router = useRouter()
const open = ref(true)
usePageHeader(() => props.title, () => props.description)

const side = computed(() => localeProperties.value.dir === 'rtl' ? 'left' : 'right')
const contentClass = computed(() => props.width === 'wide' ? 'sm:max-w-4xl' : 'max-w-xl sm:max-w-2xl')

async function onOpenUpdate(next: boolean) {
  open.value = true
  if (next) return
  await router.push(props.backTo)
  open.value = true
}
</script>

<template>
  <USlideover
    :open="open"
    :title="title"
    :description="description"
    :side="side"
    dismissible
    :ui="{ content: contentClass }"
    @update:open="onOpenUpdate"
  >
    <template #header="{ close }">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <div class="min-w-0 flex-1">
          <h1 class="text-highlighted font-semibold text-lg">{{ title }}</h1>
          <p v-if="description" class="mt-1 text-muted text-sm">{{ description }}</p>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          square
          :aria-label="t('app.close')"
          @click="close"
        />
      </div>
    </template>
    <template #body>
      <slot />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </USlideover>
</template>
