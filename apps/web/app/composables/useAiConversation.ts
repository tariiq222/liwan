import { watch, type Ref } from 'vue'

/**
 * The one conversation the assistant's full page and its sheet share: both write the id of the run they have open here
 * and follow it when the other changes it. The thread itself stays in each surface's own `useAiRun`, loaded from the id.
 */
export function useAiConversation() {
  const currentRunId = useState<string | null>('ai-current-run', () => null)
  const owner = useState<string | null>('ai-conversation-owner', () => null)
  const { me } = useMe()
  watch(() => me.value ? `${me.value.company.id}:${me.value.id}` : null, (identity) => {
    if (owner.value !== identity) currentRunId.value = null
    owner.value = identity
  }, { immediate: true, flush: 'sync' })
  const clear = () => { currentRunId.value = null }
  return { currentRunId, clear }
}

/**
 * Keeps a surface's own run on the shared conversation: the shared id changing (the page opened another run, or began a
 * new one) reloads this run, and this run getting an id (its first message started one) is written back. `startNew`
 * forgets the conversation everywhere. While `enabled` is false (a hidden sheet) nothing is loaded; when it turns true
 * the run is brought up to date at once, since the other surface may have advanced the same run meanwhile, unless this
 * run is streaming.
 */
export function followSharedConversation(
  run: { runId: Ref<string | null>; streaming: Readonly<Ref<boolean>>; load: (id: string) => Promise<void>; reset: () => void },
  enabled: () => boolean,
) {
  const { currentRunId } = useAiConversation()
  watch(currentRunId, async (id) => {
    // Ending a conversation clears hidden surfaces too, including in-flight requests on logout.
    if (id === null) { run.reset(); return }
    if (!enabled() || id === run.runId.value) return
    run.reset()
    await run.load(id)
  }, { immediate: true, flush: 'sync' })
  watch(enabled, async (now, before) => {
    if (!now || before || run.streaming.value) return
    const id = currentRunId.value
    if (id !== run.runId.value) run.reset()
    if (id) await run.load(id)
  })
  watch(run.runId, (id) => {
    if (id) currentRunId.value = id
  }, { flush: 'sync' })
  function startNew() {
    run.reset()
    currentRunId.value = null
  }
  return { startNew }
}
