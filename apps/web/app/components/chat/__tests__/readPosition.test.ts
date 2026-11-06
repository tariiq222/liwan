import { expect, it, vi } from 'vitest'
import { createReadPosition } from '../readPosition'

it('deduplicates a delayed ack and queues only the greatest advancing position', async () => {
  const releases: Array<() => void> = []
  const write = vi.fn(() => new Promise<void>(resolve => releases.push(resolve)))
  const ack = createReadPosition(write)
  const first = ack(10)
  for (let n = 0; n < 100; n++) void ack(10)
  void ack(12); void ack(11)
  expect(write.mock.calls).toEqual([[10]])
  releases.shift()!(); await Promise.resolve(); await Promise.resolve()
  expect(write.mock.calls).toEqual([[10], [12]])
  releases.shift()!(); await first
  await ack(11); await ack(12)
  expect(write).toHaveBeenCalledTimes(2)
})
it('allows a bounded deliberate retry after a failed write', async () => {
  let now = 0
  const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const ack = createReadPosition(write, () => now)
  await expect(ack(10)).rejects.toThrow('offline')
  for (let n = 0; n < 100; n++) await ack(10)
  expect(write).toHaveBeenCalledTimes(1)
  now = 5000
  await ack(10)
  expect(write).toHaveBeenCalledTimes(2)
})
