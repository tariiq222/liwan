<script setup lang="ts">
import InboxFlowFieldEditor from '@/components/inbox/InboxFlowFieldEditor.vue'
import { FLOW_FIELD_ICON, FLOW_FIELD_KINDS, FLOW_LIMITS, addField, fieldProblems, moveToIndex, screenProblems, type FlowDraft, type FlowProblem, type FlowScreenDraft, type MetaErrorSpot } from '@/composables/inbox/inboxFlow'

// One screen of the form: its title, its components in order (added from a menu by kind, moved with the arrows or by
// dragging the handle) and the footer button, which goes to the next screen or, on the last one, submits the form.
const screen = defineModel<FlowScreenDraft>({ required: true })
const props = defineProps<{
  draft: FlowDraft
  index: number
  disabled?: boolean
  problems?: FlowProblem[]
  /** Meta's errors that point at this form's screens, with the text Meta gave. */
  metaErrors?: Array<{ spot: MetaErrorSpot; message: string }>
}>()
const emit = defineEmits<{ move: [step: -1 | 1]; remove: []; focus: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const off = computed(() => !hydrated.value || !!props.disabled)
const last = computed(() => props.index === props.draft.screens.length - 1)
const own = computed(() => screenProblems(props.problems ?? [], props.index))
const metaFor = (field: number | 'footer' | null) => (props.metaErrors ?? []).filter(item => item.spot.screen === props.index && item.spot.field === field).map(item => item.message)
const menu = computed(() => FLOW_FIELD_KINDS.map(kind => ({ label: t(`inbox.flows.kind.${kind}`), icon: FLOW_FIELD_ICON[kind], onSelect: () => add(kind) })))
const dragging = ref<number | null>(null)

function add(kind: (typeof FLOW_FIELD_KINDS)[number]) {
  addField(props.draft, props.index, kind)
}
function moveField(position: number, step: -1 | 1) {
  screen.value.fields = moveToIndex(screen.value.fields, position, position + step)
}
function removeField(position: number) {
  screen.value.fields.splice(position, 1)
}
function drop(to: number) {
  if (dragging.value !== null) screen.value.fields = moveToIndex(screen.value.fields, dragging.value, to)
  dragging.value = null
}
</script>

<template>
  <SharedSubCard class="flex flex-col gap-3" :data-testid="`inbox-flow-screen-${props.index}`" @focusin="emit('focus')">
    <div class="flex items-center gap-2">
      <h3 class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted">{{ t('inbox.flows.builder.screenN', { n: props.index + 1 }) }}</h3>
      <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-up" :aria-label="t('inbox.flows.builder.moveUp')" :disabled="off || props.index === 0" @click="emit('move', -1)" />
      <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-down" :aria-label="t('inbox.flows.builder.moveDown')" :disabled="off || last" @click="emit('move', 1)" />
      <UButton type="button" color="error" variant="ghost" size="sm" icon="i-lucide-trash-2" :aria-label="t('inbox.flows.builder.removeScreen')" :disabled="off || props.draft.screens.length <= 1" :data-testid="`inbox-flow-screen-${props.index}-remove`" @click="emit('remove')" />
    </div>
    <UFormField :label="t('inbox.flows.builder.screenTitle')" required :error="own.some(item => item.prop === 'title') ? t('inbox.flows.problem.invalidProp', { prop: t('inbox.flows.prop.title') }) : undefined">
      <UInput v-model="screen.title" class="w-full" :maxlength="FLOW_LIMITS.title" :disabled="off" :data-testid="`inbox-flow-screen-${props.index}-title`" />
      <template #hint><span class="text-xs text-muted">{{ screen.title.length }}/{{ FLOW_LIMITS.title }}</span></template>
    </UFormField>

    <ol v-if="screen.fields.length" class="flex flex-col gap-3">
      <li
        v-for="(field, position) in screen.fields"
        :key="field.uid"
        class="flex gap-2 rounded-card p-3 ring ring-default"
        :class="{ 'opacity-60': dragging === position }"
        @dragover.prevent
        @drop.prevent="drop(position)"
      >
        <span
          class="mt-1 flex h-6 w-5 shrink-0 cursor-grab items-center justify-center text-dimmed"
          :draggable="!off"
          :title="t('inbox.flows.builder.drag')"
          aria-hidden="true"
          @dragstart="dragging = position"
          @dragend="dragging = null"
        ><UIcon name="i-lucide-grip-vertical" class="size-4" /></span>
        <InboxFlowFieldEditor
          v-model="screen.fields[position]!"
          class="min-w-0 flex-1"
          :index="position"
          :count="screen.fields.length"
          :disabled="off"
          :problems="fieldProblems(props.problems ?? [], props.index, position)"
          :meta-errors="metaFor(position)"
          @move="moveField(position, $event)"
          @remove="removeField(position)"
        />
      </li>
    </ol>
    <p v-else class="text-sm text-muted">{{ t('inbox.flows.builder.noFields') }}</p>
    <p v-if="own.some(item => item.code === 'noFields')" class="text-sm text-error" role="alert">{{ t('inbox.flows.problem.noFields') }}</p>

    <UDropdownMenu :items="menu" :content="{ align: 'start' }">
      <UButton type="button" class="self-start" color="neutral" variant="outline" size="sm" icon="i-lucide-plus" trailing-icon="i-lucide-chevron-down" :label="t('inbox.flows.builder.addField')" :disabled="off || screen.fields.length >= FLOW_LIMITS.fieldsPerScreen" :data-testid="`inbox-flow-screen-${props.index}-add-field`" />
    </UDropdownMenu>

    <UFormField :label="last ? t('inbox.flows.builder.footerSubmit') : t('inbox.flows.builder.footerNext')" :description="last ? t('inbox.flows.builder.footerSubmitHint') : t('inbox.flows.builder.footerNextHint')" required :error="own.some(item => item.prop === 'footer_label') ? t('inbox.flows.problem.invalidProp', { prop: t('inbox.flows.prop.footer_label') }) : undefined">
      <UInput v-model="screen.footerLabel" class="w-full" :maxlength="FLOW_LIMITS.footerLabel" :disabled="off" :data-testid="`inbox-flow-screen-${props.index}-footer`" />
      <template #hint><span class="text-xs text-muted">{{ screen.footerLabel.length }}/{{ FLOW_LIMITS.footerLabel }}</span></template>
    </UFormField>
    <ul v-if="metaFor('footer').length || metaFor(null).length" class="flex flex-col gap-0.5 text-xs text-error" role="alert">
      <li v-for="message in [...metaFor('footer'), ...metaFor(null)]" :key="message" dir="auto">{{ t('inbox.flows.meta.says') }} {{ message }}</li>
    </ul>
  </SharedSubCard>
</template>
