import { ownNotes } from '../../../utils/ai/memory'

export default defineEventHandler(event => ownNotes(event, 'GET'))
