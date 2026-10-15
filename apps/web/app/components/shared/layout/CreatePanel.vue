<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { SlideoverProps } from '@nuxt/ui'

const props = withDefaults(defineProps<{
  title: string
  backTo: RouteLocationRaw
  description?: string
  /** Deprecated and ignored: every create panel has the one width below. */
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
// One width for every /new panel (640px, full width on mobile). The body drops its bottom padding so the
// form footer (.nasq-form-footer or the #footer slot) can stick to the bottom edge with its own padding.
const panelUi = {
  content: 'w-full max-w-none sm:max-w-160',
  // The panel is teleported; the footer rules key on the shared .nasq-form-footer class. Cancel sits at the
  // inline start and the primary action at the inline end (LTR and RTL); the footer stays visible on scroll.
  body: [
    'p-4 pb-0 sm:p-6 sm:pb-0',
    '[&_.nasq-form-footer]:sticky [&_.nasq-form-footer]:bottom-0 [&_.nasq-form-footer]:z-1 [&_.nasq-form-footer]:mt-6',
    '[&_.nasq-form-footer]:bg-default [&_.nasq-form-footer]:py-4 [&_.nasq-form-footer]:justify-between!',
    '[&_.nasq-form-footer>:only-child]:ms-auto',
  ].join(' '),
}

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
    :ui="panelUi"
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
      <div class="nasq-create-panel-footer flex w-full items-center justify-between gap-2">
        <slot name="footer" />
      </div>
    </template>
  </USlideover>
</template>

