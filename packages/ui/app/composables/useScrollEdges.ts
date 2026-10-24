import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

export function scrollEdges({ scrollTop, scrollHeight, clientHeight }: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>) {
  const overflow = scrollHeight - clientHeight > 1
  return { top: overflow && scrollTop > 1, bottom: overflow && scrollTop < scrollHeight - clientHeight - 1 }
}

/** Follow both the viewport and content, including font loads, permissions and window resizing. */
export function useScrollEdges(container: Ref<HTMLElement | null>, content: Ref<HTMLElement | null>) {
  const state = ref({ top: false, bottom: false })
  let observer: ResizeObserver | undefined
  const measure = () => { state.value = container.value ? scrollEdges(container.value) : { top: false, bottom: false } }
  const observe = () => {
    observer?.disconnect()
    for (const element of [container.value, content.value]) if (element) observer?.observe(element)
    measure()
  }
  onMounted(() => {
    observer = new ResizeObserver(measure)
    observe()
  })
  watch([container, content], observe, { flush: 'post' })
  onBeforeUnmount(() => observer?.disconnect())
  return { top: computed(() => state.value.top), bottom: computed(() => state.value.bottom), measure }
}
