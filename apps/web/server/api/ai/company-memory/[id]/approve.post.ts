import { getRouterParam } from 'h3'
import { companyNotes, noteId } from '../../../../utils/ai/memory'

export default defineEventHandler((event) => {
  assertSameSiteJson(event)
  return companyNotes(event, 'POST', `/${noteId(getRouterParam(event, 'id'))}/approve`)
})
