<script setup lang="ts">
import { FORM_ACTIONS_HOST } from '../../../utils/formActions'

const panel = inject(FORM_ACTIONS_HOST, null)
const element = ref<HTMLElement | null>(null)
const owner = shallowRef<HTMLFormElement | null>(null)
const registered = ref(false)
const formId = `webvue-form-${useId()}`
const target = computed(() => registered.value ? panel?.target.value : null)

// Moving the action region must preserve the browser's native form owner.
// Explicit associations supplied by a caller take precedence.
function associateButtons() {
  if (!owner.value || !element.value) return
  for (const button of element.value.querySelectorAll<HTMLButtonElement>('button')) {
    if (['submit', 'reset'].includes(button.type) && !button.hasAttribute('form')) button.setAttribute('form', owner.value.id)
  }
}

onMounted(() => {
  if (!panel) return
  owner.value = element.value?.closest('form') ?? null
  if (!owner.value) return
  if (!owner.value.id) owner.value.id = formId
  associateButtons()
  panel.active.value++
  registered.value = true
})
onUpdated(associateButtons)
onBeforeUnmount(() => { if (registered.value && panel) panel.active.value-- })
</script>

<template>
  <Teleport :to="target || 'body'" :disabled="!target">
    <div ref="element" class="webvue-form-footer" :data-panel="registered || undefined" data-slot="form-actions"><slot /></div>
  </Teleport>
</template>
