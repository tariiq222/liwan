<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { SlideoverProps } from '@nuxt/ui'

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

// The #header slot below replaces USlideover's DialogTitle, so reka's aria-labelledby would point at
// nothing and the dialog would have no name. reka merges these content attributes after its own.
const titleId = useId()
const descriptionId = useId()
const dialogContent = computed<NonNullable<SlideoverProps['content']> & { 'aria-labelledby': string; 'aria-describedby'?: string }>(() => ({
  'aria-labelledby': titleId,
  'aria-describedby': props.description ? descriptionId : undefined,
}))

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
    :content="dialogContent"
    :ui="{ content: contentClass }"
    @update:open="onOpenUpdate"
  >
    <template #header="{ close }">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <div class="min-w-0 flex-1">
          <h1 :id="titleId" class="text-highlighted font-semibold text-lg">{{ title }}</h1>
          <p v-if="description" :id="descriptionId" class="mt-1 text-muted text-sm">{{ description }}</p>
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
