import { getRouterParam } from 'h3'
import { noteId, ownNotes } from '../../../utils/ai/memory'

export default defineEventHandler((event) => {
  assertSameSiteJson(event)
  return ownNotes(event, 'DELETE', `/v1/memory/${noteId(getRouterParam(event, 'id'))}`)
})
