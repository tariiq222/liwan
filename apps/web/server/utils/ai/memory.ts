import type { H3Event } from 'h3'
import { createError } from 'h3'
import { AiCompanyNoteListSchema, AiNoteListSchema, type AiCompanyNoteList, type AiNoteList } from '@liwan/contracts'
import { ownerFor } from './session'
import { forwardUpstream, odooJson, serviceFetch } from './upstream'

async function answered(response: Response): Promise<unknown> {
  if (response.status === 404) throw createError({ statusCode: 404, data: { code: 'not_found', message: 'note not found' } })
  if (response.status === 409) throw createError({ statusCode: 409, data: { code: 'company_memory_full', message: 'the company already has the most approved notes' } })
  if (!response.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${response.status}` } })
  return response.json()
}

/**
 * The caller's own notes. The AI service takes the owner from the service headers this server sets from the session,
 * never from the request, so one employee can neither read nor delete another's. Odoo first confirms the caller may use
 * the assistant (the tools route forwards its 403).
 */
export async function ownNotes(event: H3Event, method: 'GET' | 'DELETE', path = '/v1/memory'): Promise<AiNoteList> {
  const allowed = await odooJson(event, 'GET', '/api/v1/ai/tools')
  if (allowed.status !== 200) forwardUpstream(allowed)
  return AiNoteListSchema.parse(await answered(await serviceFetch(event, method, path, await ownerFor(event))))
}

/**
 * The current company's notes, for a settings manager of that company: Odoo names the company it authorized, and only
 * that company's notes are read, approved or deleted.
 */
export async function companyNotes(event: H3Event, method: 'GET' | 'POST' | 'DELETE', suffix = ''): Promise<AiCompanyNoteList> {
  const allowed = await odooJson(event, 'POST', '/api/v1/ai/company-memory/authorize', { body: {} })
  if (allowed.status !== 200) forwardUpstream(allowed)
  const { company_id: company } = allowed.body as { company_id: number }
  const response = await serviceFetch(event, method, `/v1/company-memory/${company}${suffix}`, await ownerFor(event))
  return AiCompanyNoteListSchema.parse(await answered(response))
}

/** A note id from the route, or a 422: only digits reach the service path. */
export function noteId(raw: string | undefined): number {
  const id = Number(raw)
  if (!raw || !/^[1-9][0-9]{0,17}$/.test(raw) || !Number.isSafeInteger(id)) throw createError({ statusCode: 422, data: { code: 'invalid', message: 'invalid note id', field: 'id' } })
  return id
}
