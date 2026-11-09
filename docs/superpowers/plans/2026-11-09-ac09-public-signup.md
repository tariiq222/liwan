# AC-09 public signup implementation plan

> Execute in the isolated AC-09 worktree. The coordinator integrates the independently owned UI and SMS transport with the database, edge, and trial integration.

## Goal

A visitor verifies a Saudi mobile and email before the existing trial and provisioning pipeline creates a workspace.

## Architecture

The prospect host forwards signed anonymous requests to the control plane. PostgreSQL owns challenges, delivery limits and single-trial claims. Order acceptance and signup completion commit atomically.

## Spec

[AC-09 public signup](../specs/2026-11-09-ac09-public-signup-design.md)

- [x] Cover and implement the Authentica SMS request, provider refusal and timeout in `apps/control-plane/src/signup/authentica.ts` and its tests.
- [x] Cover wrong, exhausted and expired codes, duplicate identity, concurrent and repeated completion, and sender failures on the dedicated scratch control database. Implement in `signup/service.ts`, register `schema_036.sql` and reuse the quote and trial engine on the transaction client.
- [x] Wire start, verify-sms, send-email and verify-email at the prospect edge and BFF. Test method and host allowlisting and signed-body tampering. Keep order details behind the customer and vendor boundaries.
- [x] Implement and check the Arabic and English public form and email invitation handoff.
- [ ] Run isolated PostgreSQL, prospect guard, type and policy checks. Exercise provisioning and invitation via the foundation stack if available. Record actual provider delivery and paid conversion separately.
