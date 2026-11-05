import { companyNotes } from '../../../utils/ai/memory'

export default defineEventHandler(event => companyNotes(event, 'GET'))
