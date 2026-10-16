import type { H3Event } from 'h3'
import { createError } from 'h3'
import { AiToolsResponseSchema, type AiTool } from '@nasq/contracts'
import { tenantRequest } from '../tenantRequest'
import { toolCallBudget } from './executor'
import { forwardUpstream, odooJson, type Owner } from './upstream'

export type RunLimits = { max_steps: number; max_tool_calls: number; timeout_seconds: number }
export type RunSession = { owner: Owner; tools: AiTool[]; byName: Map<string, AiTool>; limits: RunLimits }

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
  if ((process.env.NASQ_TENANCY_MODE ?? 'dedicated') !== 'dedicated') throw createError({ statusCode: 403, data: { code: 'forbidden', message: 'tenant boundary rejected' } })
  return `company:${companyId}`
}

/** The caller's identity and tool catalog for this request only. Any upstream denial is forwarded as is. */
export async function runSession(event: H3Event): Promise<RunSession> {
  const me = await odooJson(event, 'GET', '/api/v1/me')
  if (me.status !== 200) forwardUpstream(me)
  const tools = await odooJson(event, 'GET', '/api/v1/ai/tools')
  if (tools.status !== 200) forwardUpstream(tools)
  const parsed = AiToolsResponseSchema.parse(tools.body)
  const meBody = me.body as { id: number; company: { id: number } }
  return {
    owner: { tenant: ownerTenant(event, meBody.company.id), user: String(meBody.id) },
    tools: parsed.items,
    byName: new Map(parsed.items.map(tool => [tool.name, tool])),
    limits: { max_steps: MAX_STEPS, max_tool_calls: toolCallBudget(parsed.limits.tool_calls_per_run), timeout_seconds: TIMEOUT_SECONDS },
  }
}
