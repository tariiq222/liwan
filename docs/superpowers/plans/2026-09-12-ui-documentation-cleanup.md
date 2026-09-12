# UI documentation cleanup implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the two independent document packages. The coordinator owns assembly and verification.

**Goal:** Make the approved new frontend's instructions easy to follow, with one design authority and an explicit historical archive.

**Architecture:** Keep DESIGN.md, a runtime component catalog and a short technical reference. Archive superseded visual guidance with its evidence, and update incoming links. Preserve the existing uncommitted redesign and primary-only amendment.

**Tech Stack:** Existing Markdown/MDC, Nuxt UI and Python standard-library verification; no runtime changes.

**Spec:** The user's request to clean frontend instructions/references, explicitly selecting the approved new interface in `/Users/tariq/code/nasq-ui-redesign`.

## Global constraints

- Work in the existing isolated `codex/ui-redesign` checkout; canonical main and other worktrees remain unchanged.
- DESIGN.md is the only visual policy; the catalog locates runtime owners; the technical reference records implementation sources. Agent adapters link to the policy and preserve non-UI rules.
- The client has one configurable primary brand color; stored secondary data remains a backend compatibility field, with no client effect. Preserve all other approved behavior.
- No application, API, contract, database, dependency, test or runtime changes. No commits, Git merges, pushes, deploys, worktree/branch removal or destructive cleanup.
- Historical UI guidance is relocated with explicit historical labels, not erased. Preserve mixed product/security documents and license notices.
- Agents write only their isolated package directories. No subagents, build/lint/test suites or services in workers. Coordinator compares actual files to the before snapshot and validates once after assembly.

## Task 1: Active references

**Files:** `docs/design-system/README.md`, `components.md`, `nuxt-ui-reference.md` in the isolated reference package.
**Interfaces:** Stable authority and file names above. Other files in the design-system directory move to `docs/archive/ui/design-system/`; link to `../archive/ui/README.md` from the directory README if needed, using the correct relative path `../archive` only after checking resolution (actual archive is `docs/archive/ui`).

- [x] Reduce README to clear links and roles.
- [x] Remove catalog duplicates, ambiguous abbreviated paths and rollout/task language; verify every listed owner exists in the approved checkout. Keep catalog registration paths required by ui_policy.
- [x] Reduce technical reference to library, approved visual source, runtime CSS/config/state/chart owners and check commands. Put visual rules only in DESIGN.md and component listings only in the catalog.
- [x] Self-review and report paths/concerns, without running checks.

## Task 2: Tool entrypoints and product copy

**Files:** `GEMINI.md`, `GROK.md`, `.github/copilot-instructions.md`, `.cursor/rules/nasq-ui.mdc`, `.claude/agents/frontend-theme.md`, `docs/agents/frontend-theme.md`, `apps/web/PRODUCT.md` in the isolated adapters package.
**Interfaces:** Same stable policy/catalog paths as Task 1; no dependence on Task 1 output.

- [x] Make tool adapters short pointers to AGENTS.md, CLAUDE.md and DESIGN.md; preserve metadata and independent safety/ownership rules.
- [x] Keep frontend role bounded and point visual decisions to DESIGN.md; remove duplicated visual rules and retired owners.
- [x] Correct PRODUCT.md to primary-only client branding; retain scope and behavior.
- [x] Self-review and report paths/concerns, without running checks.

## Task 3: Archive and integrate (coordinator)

**Files:** `DESIGN.md`, root/web `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/WORKSPACE.md`, `docs/parallel-work.md`, selected historical UI documents, incoming Markdown links, `docs/archive/ui/README.md`, cleanup evidence under `docs/verification/`.
**Interfaces:** Explicit before-to-after path map in the artifact directory; workers' stable paths do not move.

- [x] Save document contents and source hashes before editing; record unchanged main.
- [x] Add a concise source/authority map to DESIGN.md without changing visual decisions. Keep entrypoints as pointers and update architecture description only if verified against source.
- [x] Move superseded visual reports/specs/plans into `docs/archive/ui/` preserving their hierarchy. Keep mixed product/security plans in place with historical visual context where necessary. Replace the stale workspace chronology with a current checkout map and preserve its full original content in the archive.
- [x] Review both worker diffs for scope and accuracy, copy only owned results whose before hashes still match, then rewrite moved links using source-relative resolution.
- [x] Verify Markdown links against the before snapshot: no new missing links; all current authority links resolve. Check all catalog paths, and no active guidance points to retired visual owners.
- [x] Run `python3 -B tools/ui_policy.py` and `git diff --check`; compare non-document source hashes and canonical hashes against the snapshot. No build or behavior suite is warranted for this documentation-only delta.
- [x] Review the complete cleanup delta independently, record actual evidence and remaining boundaries, and return the DESIGN.md entrypoint.
