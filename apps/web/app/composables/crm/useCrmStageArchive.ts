import { ref } from 'vue'
import { stageNeedsMoveTarget } from '../../utils/crmErrors'

type Archive = (input: { id: number; moveTo?: number }) => Promise<unknown>

/**
 * Archiving a stage in the pipeline card. A stage that holds opportunities is refused by the server; the card then asks
 * where they go (`choosing` is that stage's id, `target` the stage picked) and the confirm sends both in one request.
 * Any other refusal stays in `failure` for the card's message.
 */
export function useCrmStageArchive(archive: Archive) {
  const choosing = ref<number | null>(null)
  const target = ref<number | undefined>(undefined)
  const failure = ref<unknown>(null)
  const pending = ref(false)

  function cancel() {
    choosing.value = null
    target.value = undefined
  }
  async function run(id: number, moveTo?: number) {
    failure.value = null
    pending.value = true
    try {
      await archive({ id, moveTo })
      cancel()
    } catch (error) {
      if (moveTo === undefined && stageNeedsMoveTarget(error)) {
        choosing.value = id
        target.value = undefined
      } else {
        failure.value = error
      }
    } finally {
      pending.value = false
    }
  }
  return {
    choosing,
    target,
    failure,
    pending,
    cancel,
    request: (id: number) => run(id),
    confirm: async () => {
      if (choosing.value !== null && target.value !== undefined) await run(choosing.value, target.value)
    },
  }
}
