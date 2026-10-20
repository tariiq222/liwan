<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { SlideoverProps } from '@nuxt/ui'
import { FORM_ACTIONS_HOST } from '../../../utils/formActions'

const props = defineProps<{
  title: string
  backTo: RouteLocationRaw
  description?: string
}>()

const { t, localeProperties } = useI18n()
const router = useRouter()
const open = ref(true)
const footerTarget = ref<HTMLElement | null>(null)
const footerActions = ref(0)
provide(FORM_ACTIONS_HOST, { target: footerTarget, active: footerActions })
usePageHeader(() => props.title)

// The #header slot below replaces USlideover's DialogTitle, so reka's aria-labelledby would point at
// nothing and the dialog would have no name. reka merges these content attributes after its own.
const titleId = useId()
const descriptionId = useId()
const dialogContent = computed<NonNullable<SlideoverProps['content']> & { 'aria-labelledby': string; 'aria-describedby'?: string }>(() => ({
  'aria-labelledby': titleId,
  'aria-describedby': props.description ? descriptionId : undefined,
}))

const side = computed(() => localeProperties.value.dir === 'rtl' ? 'left' : 'right')
const slots = useSlots()
const panelUi = computed(() => ({
  content: 'webvue-create-panel w-full max-w-none',
  body: 'p-4 sm:p-6',
  footer: footerActions.value || slots.footer ? 'webvue-create-panel-footer-surface shrink-0' : 'hidden',
}))

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
    <template #footer>
      <div ref="footerTarget" class="webvue-create-panel-footer flex w-full flex-wrap items-center justify-between gap-2">
        <slot name="footer" />
      </div>
    </template>
  </USlideover>
</template>

