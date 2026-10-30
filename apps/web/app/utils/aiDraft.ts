import { AiDraftHandoffSchema, AiDraftPayloadSchema, type AiAuditRequest, type AiDraftHandoff, type AiDraftPayload } from '@liwan/contracts'
import { emptyObjective, type CharterDraft } from './projectCharter'

const DRAFT_PREFIX = 'liwan:ai-draft:'
const CREATED_PREFIX = 'liwan:ai-created:'
const storageKey = (draftId: string) => `${DRAFT_PREFIX}${draftId}`
const createdKey = (runId: string, callId: string) => `${CREATED_PREFIX}${runId}:${callId}`

/** The draft `/ai` left for `/projects/new?aiDraft=<id>`; a missing or corrupt entry is null, never a crash. */
export function readAiDraft(draftId: string): AiDraftHandoff | null {
  try {
    const raw = sessionStorage.getItem(storageKey(draftId))
    const parsed = raw ? AiDraftHandoffSchema.safeParse(JSON.parse(raw)) : null
    return parsed?.success ? parsed.data : null
  }
  catch {
    return null
  }
}

/**
 * Keeps a draft card's payload for the create page and returns where to go: the create page with `aiDraft`, and a `returnTo`
 * that brings the user back to `/ai` for the decision. The create page is the validation boundary: a payload without a
 * usable name still opens the form, empty.
 */
export function prepareDraftHandoff(runId: string, item: { callId: string; tool: string; payload: Record<string, unknown> }) {
  const draftId = `${runId}:${item.callId}`
  const base = { run_id: runId, call_id: item.callId, tool: item.tool }
  const parsed = AiDraftHandoffSchema.safeParse({ ...base, payload: item.payload })
  const handoff = parsed.success ? parsed.data : { ...base, payload: AiDraftPayloadSchema.partial().safeParse(item.payload).data ?? {} }
  try { sessionStorage.setItem(storageKey(draftId), JSON.stringify(handoff)) } catch { /* private mode: the page still opens empty */ }
  return { path: '/projects/new', query: { aiDraft: draftId, returnTo: `/ai?run=${runId}&resume=${item.callId}` } }
}

export function clearAiDraft(draftId: string): void {
  try {
    sessionStorage.removeItem(storageKey(draftId))
  }
  catch {
    // Storage is unavailable, so there is nothing to clear.
  }
}

/**
 * The project created from a draft, kept per run and call until the decision reached the server. A failed load or decide
 * cannot lose it, and reopening the draft cannot create a second project.
 */
export function rememberCreatedId(runId: string, callId: string, createdId: number): void {
  try { sessionStorage.setItem(createdKey(runId, callId), String(createdId)) }
  catch { /* Storage is unavailable: the id then lives only in this visit's query. */ }
}

export function readCreatedId(runId: string, callId: string): number | null {
  try { return parseCreatedId(sessionStorage.getItem(createdKey(runId, callId))) }
  catch { return null }
}

export function forgetCreatedId(runId: string, callId: string): void {
  try { sessionStorage.removeItem(createdKey(runId, callId)) }
  catch { /* Storage is unavailable, so there is nothing to forget. */ }
}

/** Sign-out: no draft or created id of this user stays in the tab for the next one. */
export function clearAiSessionState(): void {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(DRAFT_PREFIX) || key?.startsWith(CREATED_PREFIX)) sessionStorage.removeItem(key)
    }
  }
  catch { /* Storage is unavailable, so there is nothing to clear. */ }
}

/** Prefills only the charter fields the AI draft knows; everything else keeps the form's own values. */
export function charterDraftFromAi(payload: AiDraftPayload, base: CharterDraft): CharterDraft {
  const charter = payload.charter ?? {}
  const objectives = charter.objectives?.length
    ? charter.objectives.map(goal => ({ ...emptyObjective(false), goal }))
    : base.objectives
  return {
    ...base,
    name: payload.name,
    description: payload.description ?? base.description,
    dateStart: payload.date_start ?? base.dateStart,
    dateEnd: payload.date_end ?? base.dateEnd,
    rationale: charter.rationale ?? base.rationale,
    objectives,
    scope: charter.scope ?? base.scope,
    exclusions: charter.exclusions ?? base.exclusions,
    success: charter.success ?? base.success,
    assumptions: charter.assumptions ?? base.assumptions,
    constraints: charter.constraints ?? base.constraints,
  }
}

/**
 * The audit row for a project created from an AI draft. Only a handoff yields one, and the only way to the final
 * create from a draft is the form whose attestation is required, so `attested` is true by construction.
 */
export function aiApprovalAudit(handoff: AiDraftHandoff | null, createdId: number): AiAuditRequest | null {
  if (!handoff) return null
  return {
    conversation_id: handoff.run_id,
    kind: 'draft',
    tool_name: handoff.tool,
    input: handoff.payload,
    result: 'approved',
    http_status: 201,
    draft: handoff.payload,
    approved: { id: createdId },
    attested: true,
  }
}

/** `returnTo` with `created=<id>` appended, whether or not it already has a query. */
export function withCreatedProject(returnTo: string, createdId: number): string {
  const url = new URL(returnTo, 'http://liwan.local')
  url.searchParams.set('created', String(createdId))
  return `${url.pathname}${url.search}${url.hash}`
}

/** `returnTo` without `created`: what a cancel returns, which `/ai` reads as a rejection. */
export function withoutCreated(returnTo: string): string {
  const url = new URL(returnTo, 'http://liwan.local')
  url.searchParams.delete('created')
  return `${url.pathname}${url.search}${url.hash}`
}

/** The `created` query value of `/ai`: a positive plain integer, anything else is no project (a rejection). */
export function parseCreatedId(raw: unknown): number | null {
  return typeof raw === 'string' && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null
}

/** The final create of an AI draft is refused until the user attested, whatever the button state. */
export function mayFinalizeCreate(attestRequired: boolean | undefined, attested: boolean): boolean {
  return !attestRequired || attested
}
