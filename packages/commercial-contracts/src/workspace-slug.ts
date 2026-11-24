import { z } from 'zod'

// A workspace slug becomes the customer's host name, so it stays inside the DNS label rules and away from the names the
// platform or an official body already speaks for.
const WORKSPACE_SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/
const WORKSPACE_SLUG_MIN_LENGTH = 3
const WORKSPACE_SLUG_MAX_LENGTH = 30

// A punycode label or a claimed authority prefix would let a workspace imitate an entity it does not own.
const RESERVED_PREFIXES = ['gov-', 'bank-', 'xn-'] as const

/** A slug is trimmed and lowercased before any check; that is the only normalization it ever gets. */
export function normalizeWorkspaceSlug(input: string): string {
  return input.trim().toLowerCase()
}

/** Names that must never become a customer host: the platform's own, its applications, generic business words, and official bodies. */
export const RESERVED_WORKSPACE_SLUGS: ReadonlySet<string> = Object.freeze(new Set([
  // Platform infrastructure and the hosts every installation already answers on.
  'www', 'api', 'app', 'mail', 'smtp', 'imap', 'pop', 'mx', 'ns1', 'ns2', 'cdn', 'static', 'assets', 'media', 'files',
  'staging', 'prod', 'dev', 'test', 'demo', 'sandbox', 'preview', 'status', 'docs', 'help', 'support', 'billing', 'pay',
  'portal', 'auth', 'login', 'sso', 'account', 'signup', 'register', 'hooks', 'webhook', 'restore', 'admin', 'vendor',
  'internal', 'localhost',
  // LiwanOS and its applications.
  'liwan', 'liwanos', 'crm', 'hr', 'erp', 'pmo', 'tasks', 'projects', 'finance', 'inbox', 'meetings', 'ai', 'chat',
  'documents', 'helpdesk', 'sales', 'appointments', 'odoo',
  // Generic business words a customer would expect to own but that no single workspace may claim.
  'company', 'office', 'system', 'platform', 'business', 'store', 'shop', 'team', 'root', 'owner', 'manager',
  'workspace', 'enterprise', 'group', 'official',
  // Official bodies and country names, reserved so no workspace can pass for them.
  'gov', 'government', 'bank', 'ministry', 'police', 'absher', 'zatca', 'sama', 'moh', 'saudi', 'ksa',
]))

const isReserved = (slug: string) => RESERVED_WORKSPACE_SLUGS.has(slug) || RESERVED_PREFIXES.some(prefix => slug.startsWith(prefix))

const workspaceSlugShape = z.string().min(WORKSPACE_SLUG_MIN_LENGTH).max(WORKSPACE_SLUG_MAX_LENGTH)
  .regex(WORKSPACE_SLUG_SHAPE, { message: 'workspace_slug_invalid' })
  // A host of digits reads as an address, not a company name.
  .refine(slug => !/^[0-9]+$/.test(slug), { message: 'workspace_slug_invalid' })
  .refine(slug => !isReserved(slug), { message: 'workspace_slug_reserved' })

/** The one shape a workspace host may take; availability is the control plane's question, not this contract's. */
export const workspaceSlugSchema = z.string().transform(normalizeWorkspaceSlug).pipe(workspaceSlugShape)
