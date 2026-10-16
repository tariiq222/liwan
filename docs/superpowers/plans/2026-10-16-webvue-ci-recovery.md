# Local main merge gate implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Make the owner-approved local merge entrypoint run checks on an isolated combined commit and accept only that exact passing commit.
**Architecture:** Root owns safe Git orchestration and docs; one isolated Sol/high worker owns the existing pipeline/local execution helper. Integrate the helper first, review actual diffs, then run the full local pipeline and independent final review. No push or external CI reconfiguration.
**Tech Stack:** Python3 stdlib, Git, npm, Woodpecker CLI local engine, Docker/PostgreSQL/Odoo19/Playwright.
**Spec:** docs/superpowers/specs/2026-10-16-local-main-merge-design.md

## Tasks

- [ ] Implement runner and isolated resource readiness in worker lane. Focused boundary regressions before changes; no worker full suite.
- [x] Implement merge controller and real temporary-Git regressions: successful exact no-ff promotion; failed checks/conflicts/dirty paths/collisions/main-source movement; missing tooling; no push/cleanup.
- [x] Add npm entrypoint and current docs/policies explaining the tested-merge ff-only promotion and limits. Existing manual gates remain binding.
- [ ] Integrate worker diff, run focused tests and root gates; run actual full local checks and independent Sol review. Fix blockers without weakening assertions.
- [ ] Commit/integrate only authorized gate work into latest main after fresh checks, preserving all other writers. No GitHub push or hook change.
