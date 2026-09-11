<script setup lang="ts">
import { filterDepartmentTree, type DepartmentTreeNode } from '@/lib/departmentTree'
import {
  fitOrgChart,
  layoutDepartmentOrgChart,
  nextOrgScale,
  type OrgChartBox,
} from '@/lib/departmentOrgChart'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = defineProps<{
  roots: DepartmentTreeNode[]
  query?: string
  hydrated: boolean
  returnTo: string
}>()

const { locale, t } = useI18n()
const rtl = computed(() => locale.value === 'ar' || locale.value.startsWith('ar'))
const filteredRoots = computed(() => filterDepartmentTree(props.roots, props.query ?? ''))
const layout = computed(() => layoutDepartmentOrgChart(filteredRoots.value, { rtl: rtl.value }))
const viewport = ref<HTMLElement | null>(null)
const chartSection = ref<HTMLElement | null>(null)
const scale = ref(1)
const fullscreen = ref(false)
let previousBodyOverflow = ''
const drag = ref<{ id: number; x: number; y: number; sl: number; st: number } | null>(null)

function fit() {
  const el = viewport.value
  if (!el || !layout.value.boxes.length) {
    scale.value = 1
    return
  }
  const next = fitOrgChart(layout.value, el.clientWidth, el.clientHeight)
  scale.value = next.scale
  requestAnimationFrame(() => {
    el.scrollLeft = next.scrollX
    el.scrollTop = next.scrollY
  })
}

async function toggleFullscreen() {
  if (!props.hydrated || !chartSection.value) return
  const next = !fullscreen.value
  if (next) previousBodyOverflow = document.body.style.overflow
  fullscreen.value = next
  document.body.style.overflow = next ? 'hidden' : previousBodyOverflow
  await nextTick()
  requestAnimationFrame(fit)
}

function zoomBy(factor: number) {
  const el = viewport.value
  const prev = scale.value
  const next = nextOrgScale(prev, factor)
  if (next === prev) return
  const cx = el ? el.scrollLeft + el.clientWidth / 2 : 0
  const cy = el ? el.scrollTop + el.clientHeight / 2 : 0
  scale.value = next
  requestAnimationFrame(() => {
    if (!el) return
    el.scrollLeft = cx * (next / prev) - el.clientWidth / 2
    el.scrollTop = cy * (next / prev) - el.clientHeight / 2
  })
}

function onWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1)
}

function onPointerDown(event: PointerEvent) {
  if (!props.hydrated || event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return
  if ((event.target as HTMLElement).closest('a,button')) return
  const el = viewport.value
  if (!el) return
  el.setPointerCapture(event.pointerId)
  drag.value = { id: event.pointerId, x: event.clientX, y: event.clientY, sl: el.scrollLeft, st: el.scrollTop }
}

function onPointerMove(event: PointerEvent) {
  const el = viewport.value
  const state = drag.value
  if (!el || !state || event.pointerId !== state.id) return
  el.scrollLeft = state.sl - (event.clientX - state.x)
  el.scrollTop = state.st - (event.clientY - state.y)
}

function endDrag(event: PointerEvent) {
  if (drag.value?.id !== event.pointerId) return
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId)
  drag.value = null
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && fullscreen.value) { event.preventDefault(); void toggleFullscreen(); return }
  if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.2) }
  else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomBy(1 / 1.2) }
  else if (event.key === '0') { event.preventDefault(); fit() }
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && fullscreen.value) { event.preventDefault(); void toggleFullscreen() }
}

function nodeLabel(box: OrgChartBox) {
  return `${box.name}, ${box.manager || t('hr.depts.noManager')}, ${t('hr.depts.employeeReason', { count: box.employeeCount })}`
}

function nodeStyle(box: OrgChartBox) {
  return {
    insetInlineStart: `${box.x}px`,
    insetBlockStart: `${box.y}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
  }
}

watch(
  () => [layout.value.width, layout.value.height, layout.value.boxes.length, props.query],
  () => { void nextTick(fit) },
)
onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  void nextTick(fit)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  if (fullscreen.value) document.body.style.overflow = previousBodyOverflow
  drag.value = null
})
</script>

<template>
  <section
    ref="chartSection"
    class="relative flex h-[calc(100svh-14rem)] flex-col overflow-hidden rounded-lg border border-default bg-default shadow-sm"
    :class="{ 'hr-org-chart-expanded': fullscreen }"
    data-testid="hr-department-org-chart"
    :aria-label="$t('hr.depts.orgChart')"
  >
    <div
      v-if="layout.boxes.length"
      class="flex shrink-0 items-center justify-end gap-0.5 border-b border-default p-2"
      role="group"
      :aria-label="$t('hr.depts.orgChartControls')"
    >
      <UButton
        type="button"
        color="secondary"
        variant="ghost"
        square
        :disabled="!hydrated || nextOrgScale(scale, 1.2) === scale"
        :aria-label="$t('hr.depts.zoomIn')"
        icon="i-lucide-zoom-in"
        data-testid="hr-org-zoom-in"
        @click="zoomBy(1.2)"
      />
      <UButton
        type="button"
        color="secondary"
        variant="ghost"
        square
        :disabled="!hydrated || nextOrgScale(scale, 1 / 1.2) === scale"
        :aria-label="$t('hr.depts.zoomOut')"
        icon="i-lucide-zoom-out"
        data-testid="hr-org-zoom-out"
        @click="zoomBy(1 / 1.2)"
      />
      <UButton
        type="button"
        color="secondary"
        variant="ghost"
        square
        :disabled="!hydrated"
        :aria-label="$t('hr.depts.zoomFit')"
        icon="i-lucide-scan"
        data-testid="hr-org-zoom-fit"
        @click="fit"
      />
      <UButton
        type="button"
        color="secondary"
        variant="ghost"
        square
        :disabled="!hydrated"
        :aria-label="$t(fullscreen ? 'hr.depts.fullscreenExit' : 'hr.depts.fullscreen')"
        :aria-pressed="fullscreen"
        :title="$t(fullscreen ? 'hr.depts.fullscreenExit' : 'hr.depts.fullscreen')"
        :icon="fullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
        data-testid="hr-org-fullscreen"
        @click="toggleFullscreen"
      />
    </div>
    <div
      v-if="layout.boxes.length"
      ref="viewport"
      dir="ltr"
      class="min-h-0 flex-1 cursor-grab overflow-auto active:cursor-grabbing"
      data-testid="hr-org-viewport"
      tabindex="0"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @keydown="onKeydown"
    >
      <div :style="{ width: `${layout.width * scale}px`, height: `${layout.height * scale}px` }">
        <div
          class="relative"
          :style="{ width: `${layout.width}px`, height: `${layout.height}px`, transform: `scale(${scale})`, transformOrigin: '0 0' }"
        >
          <svg
            class="pointer-events-none absolute inset-0"
            :width="layout.width"
            :height="layout.height"
            :viewBox="`0 0 ${layout.width} ${layout.height}`"
            aria-hidden="true"
          >
            <path
              v-for="edge in layout.edges"
              :key="`${edge.from}-${edge.to}`"
              :d="edge.d"
              fill="none"
              class="stroke-border"
              stroke-width="1.5"
              :data-from="edge.from"
              :data-to="edge.to"
            />
          </svg>
          <NuxtLink
            v-for="box in layout.boxes"
            :key="box.id"
            :to="{ path: `/hr/departments/${box.id}`, query: returnToQuery(returnTo) }"
            dir="ltr"
            class="absolute overflow-hidden rounded-lg border border-default bg-default px-3 py-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :class="{ 'pointer-events-none opacity-60': !hydrated }"
            :style="nodeStyle(box)"
            :title="nodeLabel(box)"
            :aria-label="nodeLabel(box)"
            :tabindex="hydrated ? 0 : -1"
            :aria-disabled="!hydrated ? 'true' : undefined"
            :data-testid="`hr-org-node-${box.id}`"
            :data-depth="box.depth"
            @click="!hydrated && $event.preventDefault()"
          >
            <span class="flex h-full flex-col justify-center text-start" :dir="rtl ? 'rtl' : 'ltr'" data-org-node-text>
              <span class="line-clamp-2 text-pretty text-sm font-medium leading-5">{{ box.name }}</span>
              <span class="mt-1 line-clamp-1 text-xs text-muted">{{ box.manager || $t('hr.depts.noManager') }}</span>
              <span class="line-clamp-1 text-xs text-muted">{{ $t('hr.depts.employeeReason', { count: box.employeeCount }) }}</span>
            </span>
          </NuxtLink>
        </div>
      </div>
    </div>
    <p v-else class="py-10 text-center text-sm text-muted">{{ $t('hr.depts.empty') }}</p>
  </section>
</template>

<style scoped>
.hr-org-chart-expanded {
  position: fixed;
  inset: 0;
  z-index: 50;
  width: 100vw;
  height: 100vh;
  border-radius: 0;
  background: var(--background);
}
</style>
