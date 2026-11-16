<script setup lang="ts">
import type { SalesSignatureMethod, SalesSignatureMethods } from '@liwan/contracts'
import { pngBase64 } from '@/composables/sales/salesQuote'
import { INK } from '@/utils/liwanPalette'

// The box a customer draws a signature in, with a finger, a pen or a mouse. Without a pointer, the button writes the
// signer's typed name into the same box in an italic hand; editing the name afterwards removes that typed signature,
// a drawn one stays. The model is the drawing as a base64 PNG (dark ink on a transparent ground, no `data:` prefix)
// once a stroke ends or the name is written, and null while the box is empty. `method` says which of the two made the
// current signature (drawing over a typed name makes it drawn; typing replaces a drawing), and the name button is
// absent when the sender only accepts a drawn signature. The ink is the brand ink in every theme:
// the PNG is shown on a white box and printed on white paper, so a light dark-theme text colour would vanish there.
// The canvas is a fixed 480 x 160 so the picture stays small however large the box is drawn.
const props = withDefaults(defineProps<{ disabled?: boolean; signerName?: string; methods?: SalesSignatureMethods }>(), { methods: 'draw_or_type' })
const model = defineModel<string | null>({ default: null })
const method = defineModel<SalesSignatureMethod | null>('method', { default: null })
const { t } = useI18n()
const WIDTH = 480
const HEIGHT = 160
const STROKE = 2.5
const TYPED_PADDING = 24
const TYPED_SIZE_MAX = 64
const TYPED_SIZE_MIN = 20
const typedFont = (size: number) => `italic 600 ${size}px "IBM Plex Sans Arabic", cursive`
const ARABIC = /\p{Script=Arabic}/u
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
let last: { x: number; y: number } | null = null
const hintId = useId()
const typedName = computed(() => (props.signerName ?? '').trim())

const context = () => canvas.value?.getContext('2d') ?? null

onMounted(() => {
  const ctx = context()
  if (!ctx || !canvas.value) return
  ctx.lineWidth = STROKE
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = INK
})

function point(event: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height }
}

function line(from: { x: number; y: number }, to: { x: number; y: number }) {
  const ctx = context()
  if (!ctx) return
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
}

function start(event: PointerEvent) {
  // One finger or the main mouse button: a second touch or a right click does not draw.
  if (props.disabled || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
  canvas.value!.setPointerCapture(event.pointerId)
  last = point(event)
  // A tap leaves a dot.
  line(last, { x: last.x + 0.01, y: last.y })
}

function move(event: PointerEvent) {
  if (!last) return
  const next = point(event)
  line(last, next)
  last = next
}

function end() {
  if (!last) return
  last = null
  method.value = 'drawn'
  model.value = pngBase64(canvas.value!.toDataURL('image/png'))
}

/** Writes the signer's name across the box, as large as fits, replacing whatever is drawn. */
async function signWithName() {
  const ctx = context()
  const name = typedName.value
  if (!ctx || !name || props.disabled) return
  await document.fonts?.load(typedFont(TYPED_SIZE_MAX), name)
  // The name was edited while the font loaded: this picture would say the old one.
  if (typedName.value !== name) return
  ctx.clearRect(0, 0, WIDTH, HEIGHT)
  let size = TYPED_SIZE_MAX
  ctx.font = typedFont(size)
  while (size > TYPED_SIZE_MIN && ctx.measureText(name).width > WIDTH - 2 * TYPED_PADDING) {
    size -= 2
    ctx.font = typedFont(size)
  }
  ctx.direction = ARABIC.test(name) ? 'rtl' : 'ltr'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = INK
  ctx.fillText(name, WIDTH / 2, HEIGHT / 2, WIDTH - 2 * TYPED_PADDING)
  method.value = 'typed'
  model.value = pngBase64(canvas.value!.toDataURL('image/png'))
}

function clear() {
  context()?.clearRect(0, 0, WIDTH, HEIGHT)
  method.value = null
  model.value = null
}

watch(typedName, () => { if (method.value === 'typed') clear() })
// A sender that takes a drawn signature only cannot take a typed one that was made before.
watch(() => props.methods, methods => { if (methods === 'draw' && method.value === 'typed') clear() })
</script>

<template>
  <div class="grid gap-2">
    <canvas
      ref="canvas"
      :width="WIDTH"
      :height="HEIGHT"
      role="img"
      :aria-label="t('sales.quote.signatureLabel')"
      :aria-describedby="hintId"
      class="block h-auto w-full touch-none rounded-control bg-white ring ring-default"
      :class="props.disabled ? 'opacity-60' : 'cursor-crosshair'"
      data-testid="quote-signature-pad"
      @pointerdown="start"
      @pointermove="move"
      @pointerup="end"
      @pointercancel="end"
    />
    <p class="sr-only" role="status" aria-live="polite" data-testid="quote-signature-state">{{ model ? t('sales.quote.signatureSigned') : t('sales.quote.signatureEmpty') }}</p>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p :id="hintId" class="text-xs text-muted">{{ t(props.methods === 'draw' ? 'sales.quote.signatureHintDraw' : 'sales.quote.signatureHint') }}</p>
      <div class="flex flex-wrap gap-2">
        <UButton v-if="props.methods === 'draw_or_type'" type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-signature" :disabled="props.disabled || !typedName" :label="t('sales.quote.signatureTyped')" :aria-describedby="hintId" data-testid="quote-signature-typed" @click="signWithName" />
        <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-eraser" :disabled="props.disabled" :label="t('sales.quote.signatureClear')" data-testid="quote-signature-clear" @click="clear" />
      </div>
    </div>
  </div>
</template>
