import { onMounted, ref } from 'vue'

const SECTION_KEY = 'liwan-assistant-now-hidden'

/**
 * Whether the sheet's "in this page now" section is folded to its title row. Remembered for the browser session; storage can
 * be absent or throw (private windows), and the section then simply starts shown. Read after mount so server and client agree.
 */
export function useAiNowSection() {
  const hidden = ref(false)
  onMounted(() => {
    try { hidden.value = sessionStorage.getItem(SECTION_KEY) === 'hidden' } catch { /* shown */ }
  })
  function toggle() {
    hidden.value = !hidden.value
    try { sessionStorage.setItem(SECTION_KEY, hidden.value ? 'hidden' : 'shown') } catch { /* not remembered */ }
  }
  return { hidden, toggle }
}
