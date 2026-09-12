> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Unified Nasq components and company colour

> تاريخي. السياسة: [DESIGN.md](../../../../../DESIGN.md). ليس تعليمات واجهة.

Approved in chat on 2026-09-05. Implement the existing quiet Arabic RTL design through reusable components; keep stock Odoo untouched.

## Scope and behaviour

- Shared PageHeader, FilterBar, EmptyState and semantic status vocabulary used by projects, tasks and HR. Preserve all current actions, filters, query persistence, permissions, hydration guards and HR document flows.
- Consistent spacing, input/button heights and mobile wrapping. Icon-only controls have accessible names; focus is visible. Include loading, disabled and error examples in the component guide.
- Company identity is controlled by customer_admin/vendor in Settings > Branding. One primary HEX colour, palette presets, colour picker and text input, scoped live preview, explicit save, reset-to-default draft and cancel-to-saved draft. Reset is not persisted until Save. Saving survives reload and uses res.company as source of truth.
- Derive primary foreground using contrasting black/white, plus an accessible link colour and focus ring. White/yellow brand choices must remain readable. Do not let brand choices recolour success/warning/error. Completed tasks and projects both use success.
- Reuse the committed branding-only Phase 3b implementation from 91c0ee2 where needed; do not merge that branch or copy its unrelated HR/account work or live uncommitted changes.
- Main and other active worktrees are unchanged. No commit, merge, push, deploy or cleanup is authorized. Output is reviewable local implementation and local preview.

## Interfaces

Branding retains {name,logo_url,primary_color,font}. Branding PATCH accepts only {primary_color}; institution name/logo are managed exclusively by Odoo system administrators, with direct ORM guards and 403 for identity fields on the Nasq API; HEX validation on both boundaries. GET /api/v1/admin/branding and PATCH /api/v1/admin/branding require existing admin roles; public GET branding is safe read-only. Derivation is a pure exported utility in apps/web/app/utils/brandTheme.ts: createBrandTheme(input: string): Record<string,string>, DEFAULT_PRIMARY = '#18181b'. Invalid input falls back safely. CSS keys include --primary, --primary-foreground, --brand-link, --ring, --sidebar-primary, --sidebar-primary-foreground, --sidebar-ring.

## Verification

Unit contrast tests cover black, white, yellow, existing dark default, malformed inputs and hostile CSS text. Integration tests prove unauthorized writes are rejected and saved values reread, using a fresh isolated database (never odoo19). Web typecheck/build and focused browser tests cover settings save/reload/cancel/reset, keyboard labels, responsive guide, representative project/task/HR headers and existing filter flows. Report exactly which checked layers passed.
