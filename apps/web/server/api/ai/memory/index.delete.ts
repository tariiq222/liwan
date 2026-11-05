import { ownNotes } from '../../../utils/ai/memory'

export default defineEventHandler((event) => {
  assertSameSiteJson(event)
  return ownNotes(event, 'DELETE')
})
