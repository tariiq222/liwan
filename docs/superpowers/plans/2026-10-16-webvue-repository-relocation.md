# WebVue repository relocation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move the canonical checkout to `/Users/tariq/code/webvue`, rename its existing GitHub repository to `tariiq222/webvue`, and preserve active work.

**Architecture:** One coordinator sequences the physical move, Git worktree repair, remote replacement and active documentation changes. Preserve branch heads, dirty bytes, repository ID and access settings. Active workers own their own runtime fixtures and restart after cutover.

**Tech Stack:** Git, GitHub CLI, Python 3, npm/Nuxt/Odoo acceptance runtime.

**Spec:** Owner request in this chat, 2026-10-16; prior namespace acceptance in `docs/verification/2026-10-16-webvue-namespace.md`.

## Global constraints

- No push, production deployment, unrelated integration, database deletion, branch/worktree removal or historical evidence rewrite.
- Preserve upstream Odoo and all active writers; wait for the active coordinator's safe point.
- Use the existing isolated `codex/core-webvue-rename` worktree for source changes; it fast-forwarded to main `ec88b4b0` before this continuation.
- Codex UI access is denied and no project-path mutation tool exists. Preserve current chats through a filesystem symlink if needed; document that saved app paths require reopening the new folder.
- Worker-owned virtualenv/config repairs remain with their owner; the coordinator repairs the namespace acceptance runtime only.

## Review focus

- Nested and external linked worktrees must retain exact HEAD, index, and dirty content.
- Absolute venv, generated Nuxt and runtime paths must resolve after moving the parent directory.
- GitHub repository ID, privacy, branches and permission settings must survive rename; fetch uses the new URL.
- Older chats and external tooling must keep resolving their saved working directories during transition.
- Historical reports and independent `nasq-wt`, reference downloads and evidence directories remain truthful.

### Task 1: Prepare active references and stronger namespace guard

**Files:** `AGENTS.md`, `README.md`, `docs/{WORKSPACE,parallel-work,testing}.md`, `docs/agents/integration-rules.md`, `deploy/OPERATIONS.md`, `.claude/scripts/guard-bash.sh`, `tools/test_product_namespace.py`.

- [x] Add old canonical-path and old GitHub-URL regression cases; observe failure under the former exemptions.
- [x] Remove only the retired canonical/repository exemptions and update active references to their new destinations. Historical prose and independent evidence paths remain unchanged.
- [x] Run focused namespace/policy/guard checks and inspect actual diffs.

### Task 2: Rename the existing GitHub repository

- [x] Record repository ID, privacy, branch heads, hook/status metadata and admin permission; verify new name is unused.
- [x] Run `gh repo rename webvue -R tariiq222/nasq --yes`.
- [x] Verify identical repository ID, privacy and remote heads, and new canonical URL. Update local shared remote to the new HTTPS URL; fetch read-only.

### Task 3: Move and repair local resources

- [x] Record hashes/status/HEAD for every worktree, config backups and live runtime ownership. Receive active-worker safe point.
- [x] Atomically rename the physical directory and establish a temporary old-path symlink for existing app sessions.
- [x] Run Git worktree repair with every moved and external path. Verify all HEADs and dirty bytes are preserved.
- [x] Update active trust/path config without changing credentials or unrelated settings. Repair this task's venv/config paths; active workers repair their own.
- [x] Restart isolated acceptance runtime from new paths; verify browser/API/data health.

### Task 4: Integrate and verify

- [x] Run the relevant root tests and type/build checks in the isolated workspace; verify new-path commands and remote fetch.
- [x] Obtain independent read-only Sol review, inspect all changed files, then commit/integrate this authorized continuation into latest main per integration policy.
- [x] Confirm main tree equals the verified candidate, dirty user files survived, all worktrees remain valid, and no push/deploy happened.
- [x] Notify the active coordinator with new paths, remote and test evidence. Record remaining saved-app path limitation precisely.
