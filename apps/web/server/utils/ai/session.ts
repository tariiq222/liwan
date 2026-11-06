import type { H3Event } from 'h3'
import { createError } from 'h3'
import { AiToolsResponseSchema, type AiAgent, type AiPolicy, type AiTool } from '@liwan/contracts'
import { tenantRequest } from '../tenantRequest'
import { toolCallBudget } from './executor'
import { aiTokenKey, type TokenKey } from './outbound'
import { forwardUpstream, odooJson, type Owner } from './upstream'

export type RunLimits = { max_steps: number; max_tool_calls: number; timeout_seconds: number }
export type RunMode = 'assistant' | 'setup'
export type RunSession = { mode: RunMode; owner: Owner; company: string; tools: AiTool[]; agents: AiAgent[]; byName: Map<string, AiTool>; blockedFields: ReadonlySet<string>; tokenKey: TokenKey; limits: RunLimits; policy: AiPolicy }

const MAX_STEPS = 12
const TIMEOUT_SECONDS = 120

/**
 * The owner's tenant is the one the shared edge resolved, else the dedicated lane's database. Only a dedicated deployment
 * without a database name falls back to the company id; a shared request without a resolved tenant is refused.
 */
function ownerTenant(event: H3Event, companyId: number): string {
  const resolved = tenantRequest(event)
  if (resolved) return resolved.tenantId
  const { odooDb } = useRuntimeConfig(event)
  if (odooDb) return odooDb
  if ((process.env.LIWAN_TENANCY_MODE ?? 'dedicated') !== 'dedicated') throw createError({ statusCode: 403, data: { code: 'forbidden', message: 'tenant boundary rejected' } })
  return `company:${companyId}`
}

/** The caller as the AI service knows them (the tenant and the user id), and their current company. Any upstream denial is forwarded as is. */
async function callerFor(event: H3Event): Promise<{ owner: Owner; company: string }> {
  const me = await odooJson(event, 'GET', '/api/v1/me')
  if (me.status !== 200) forwardUpstream(me)
  const meBody = me.body as { id: number; company: { id: number } }
  return { owner: { tenant: ownerTenant(event, meBody.company.id), user: String(meBody.id) }, company: String(meBody.company.id) }
}

/** The caller as the AI service knows them: the tenant and the user id. */
export async function ownerFor(event: H3Event): Promise<Owner> {
  return (await callerFor(event)).owner
}

/** The mode a conversation of the caller started in (from its first message's audit row), or null for a new one. */
export async function conversationMode(event: H3Event, runId: string): Promise<RunMode | null> {
  const answer = await odooJson(event, 'GET', `/api/v1/ai/conversations/${encodeURIComponent(runId)}/mode`)
  if (answer.status !== 200) forwardUpstream(answer)
  return (answer.body as { mode: RunMode | null }).mode
}

/** The caller's identity, tool catalog, agents and AI policy for this request only. Any upstream denial is forwarded as is. */
export async function runSession(event: H3Event, mode: RunMode = 'assistant'): Promise<RunSession> {
  const { owner, company } = await callerFor(event)
  // A setup conversation gets the setup agent's catalog only; an ordinary one never gets it (Odoo decides both).
  const tools = await odooJson(event, 'GET', '/api/v1/ai/tools', mode === 'setup' ? { query: { mode } } : undefined)
  if (tools.status !== 200) forwardUpstream(tools)
  const parsed = AiToolsResponseSchema.parse(tools.body)
  return {
    mode,
    owner,
    company,
    tools: parsed.items,
    agents: parsed.agents,
    byName: new Map(parsed.items.map(tool => [tool.name, tool])),
    blockedFields: new Set(parsed.blocked_fields),
    tokenKey: aiTokenKey(event, owner),
    limits: { max_steps: MAX_STEPS, max_tool_calls: toolCallBudget(parsed.limits.tool_calls_per_run), timeout_seconds: TIMEOUT_SECONDS },
    policy: parsed.limits.policy,
  }
}
