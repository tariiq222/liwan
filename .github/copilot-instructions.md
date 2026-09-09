<!-- NASQ UPDATE GATE BEGIN -->
## Mandatory update approval

Read `/Users/tariq/code/nasq/docs/UPDATE_POLICY.md` before any dependency, Odoo, addon,
vendor, runtime or database-module update. This applies to all agents and tools.
First inspect exact changes and security-vs-core/customization impacts, present
an Arabic report, then wait for Tariq's explicit approval of that exact proposal.
Security-only updates also require approval. Never bypass a denial, disable hooks,
forge an approval record or answer a human confirmation prompt. Earlier general
permission to update is superseded. New tools/delegates must inherit this rule.
Hook mechanics and actual coverage: `/Users/tariq/code/nasq/tools/update_gate/README.md`.
<!-- NASQ UPDATE GATE END -->

# Nasq project instructions

Read `AGENTS.md` and `CLAUDE.md` at the repository root.
For UI work, follow `DESIGN.md`, `apps/web/AGENTS.md`, `docs/design-system/components.md` and `docs/agents/frontend-theme.md`.
Reuse the approved shell, contextual module navigation and shared components. Do not introduce another theme or copy old UI recipes. Preserve project safety, data, capabilities and route contracts.
This file is a thin project-local entrypoint; the complete UI policy lives only in `DESIGN.md`.
