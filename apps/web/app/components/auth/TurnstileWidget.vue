<script setup lang="ts">
// The Cloudflare Turnstile check of the public sign-up page. The control plane decides whether a token is good; this
// component only shows the widget, hands the page a fresh token and forgets it when it expires, fails or is reset.
// The script URL comes from the control plane's sign-up config, so a build that never gets that config loads nothing.
type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

const props = defineProps<{ siteKey: string; scriptUrl: string; language: 'ar' | 'en'; label: string }>()
const emit = defineEmits<{ verified: [token: string]; cleared: []; failed: [] }>()

const host = ref<HTMLElement>()
let widgetId: string | undefined
let loading: Promise<TurnstileApi> | undefined

function api(): TurnstileApi | undefined {
  return (globalThis as { turnstile?: TurnstileApi }).turnstile
}

function loadScript(): Promise<TurnstileApi> {
  const ready = api()
  if (ready) return Promise.resolve(ready)
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${props.scriptUrl}?render=explicit`
    script.async = true
    script.onload = () => { const loaded = api(); loaded ? resolve(loaded) : reject(new Error('turnstile_missing')) }
    script.onerror = () => { script.remove(); loading = undefined; reject(new Error('turnstile_blocked')) }
    document.head.append(script)
  })
  return loading
}

async function draw() {
  if (!host.value) return
  try {
    const turnstile = await loadScript()
    if (!host.value) return
    if (widgetId) turnstile.remove(widgetId)
    widgetId = turnstile.render(host.value, {
      sitekey: props.siteKey, theme: 'auto', size: 'normal', appearance: 'always', language: props.language, retry: 'auto',
      callback: (token: string) => emit('verified', token),
      'expired-callback': () => emit('cleared'),
      'timeout-callback': () => emit('cleared'),
      'error-callback': () => { emit('cleared'); emit('failed') },
    })
  } catch {
    emit('failed')
  }
}

/** A token is single-use: the page calls this after every request that spent one. */
function reset() {
  const turnstile = api()
  if (turnstile && widgetId) turnstile.reset(widgetId)
  emit('cleared')
}

onMounted(draw)
watch(() => props.language, draw)
onBeforeUnmount(() => { if (widgetId) api()?.remove(widgetId) })
defineExpose({ reset })
</script>

<template>
  <div role="group" :aria-label="label" class="flex min-h-[65px] justify-center" dir="ltr">
    <div ref="host" />
  </div>
</template>
