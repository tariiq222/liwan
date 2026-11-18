import { describe, expect, it, vi } from 'vitest'
import { useCrmStageArchive } from '../useCrmStageArchive'

const refusal = (reason: string) => ({ status: 422, details: { reason } })

describe('useCrmStageArchive', () => {
  it('archives an empty stage in one request, with no target', async () => {
    const archive = vi.fn(async () => undefined)
    const flow = useCrmStageArchive(archive)
    await flow.request(3)
    expect(archive).toHaveBeenCalledExactlyOnceWith({ id: 3, moveTo: undefined })
    expect(flow.choosing.value).toBeNull()
    expect(flow.failure.value).toBeNull()
  })

  it('asks for a target when the stage holds opportunities, then moves and archives with the picked stage', async () => {
    const archive = vi.fn(async (input: { id: number; moveTo?: number }) => {
      if (input.moveTo === undefined) throw refusal('stage_has_opportunities')
    })
    const flow = useCrmStageArchive(archive)
    await flow.request(3)
    expect(flow.choosing.value).toBe(3)
    expect(flow.failure.value).toBeNull()
    await flow.confirm()
    expect(archive).toHaveBeenCalledTimes(1)
    flow.target.value = 2
    await flow.confirm()
    expect(archive).toHaveBeenCalledTimes(2)
    expect(archive).toHaveBeenLastCalledWith({ id: 3, moveTo: 2 })
    expect(flow.choosing.value).toBeNull()
    expect(flow.target.value).toBeUndefined()
  })

  it('keeps the choice open and reports the refusal when the target is refused', async () => {
    const archive = vi.fn(async (input: { id: number; moveTo?: number }) => {
      throw refusal(input.moveTo === undefined ? 'stage_has_opportunities' : 'invalid_move_target')
    })
    const flow = useCrmStageArchive(archive)
    await flow.request(3)
    flow.target.value = 4
    await flow.confirm()
    expect(flow.choosing.value).toBe(3)
    expect(flow.failure.value).toEqual(refusal('invalid_move_target'))
  })

  it('reports any other refusal without asking for a target, and cancel closes the choice', async () => {
    const flow = useCrmStageArchive(async () => { throw refusal('won_stage_required') })
    await flow.request(9)
    expect(flow.choosing.value).toBeNull()
    expect(flow.failure.value).toEqual(refusal('won_stage_required'))
    const asking = useCrmStageArchive(async () => { throw refusal('stage_has_opportunities') })
    await asking.request(1)
    asking.cancel()
    expect(asking.choosing.value).toBeNull()
  })
})
