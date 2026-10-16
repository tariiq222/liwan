import { ref } from 'vue'

export type CopyOutcome = 'copied' | 'failed'

/** Copies a link and remembers the result for that link only, so a new link never inherits "copied". */
export function createCopyLink(write: (text: string) => Promise<void>) {
  const last = ref<{ link: string, outcome: CopyOutcome } | null>(null)
  async function copy(link: string): Promise<void> {
    try {
      await write(link)
      last.value = { link, outcome: 'copied' }
    } catch {
      last.value = { link, outcome: 'failed' }
    }
  }
  const outcomeFor = (link: string): CopyOutcome | null => (last.value?.link === link ? last.value.outcome : null)
  return { copy, outcomeFor }
}

export const useCopyLink = () => createCopyLink(text => navigator.clipboard.writeText(text))
