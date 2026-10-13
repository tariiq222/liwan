# Agent instructions restructure: findings and proposal (phase D)

Date: 2026-10-13. Status: analysis only. `CLAUDE.md` and `AGENTS.md` are the contract and are
not edited until the owner answers the decisions in section 5.

## 1. What was measured

| File | Lines | Note |
| --- | --- | --- |
| `CLAUDE.md` | 469 | loaded in full at the start of every Claude session |
| `AGENTS.md` | 216 | read by Codex; Claude is also pointed at it |
| Verbatim overlap | about 57 lines | `AGENTS.md` lines 53-109 (R1-R10, the baseline paragraph and "Git workflow") copy `CLAUDE.md` lines 37-96 |

The two copies have already drifted: the `<area>` sentence in `CLAUDE.md` ("the application areas
... are derived from the rank-4 addons") is missing from `AGENTS.md`.

## 2. Conflicts inside the contract (need an owner decision)

| # | Where | Conflict | Evidence |
| --- | --- | --- | --- |
| C1 | `CLAUDE.md:90`, `AGENTS.md:104` vs `AGENTS.md:147` | Merge method. Git workflow says `git merge --no-ff`; the "Preserve approved work on every merge" section says promote with a fast-forward. | grep of both files. The merges made in this task followed `--no-ff` (the Git workflow section). |
| C2 | `CLAUDE.md:235-236` and `:265` vs the manifests | "version `19.0.1.0.0`" for addons, while manifests are `nasq_core 19.0.1.2.0`, `nasq_platform 19.0.1.3.0`, `nasq_pmo 19.0.1.4.0`, `nasq_hr` and `nasq_chat` 19.0.1.1.0. `AGENTS.md:182` lists some of these numbers, which are stale (platform and chat missing). | `grep "'version'" odoo-addons/*/__manifest__.py` |
| C3 | `AGENTS.md:210-211` | "No project pre-commit ... was found; do not introduce another convention." Local git hooks now exist (`tools/hooks.py`, opt-in, installed on this checkout). | commit `ac7963bc` |
| C4 | `AGENTS.md:178-179` | "Test execution needs authorization; this setup does not authorize Odoo startup." `CLAUDE.md` authorizes the scratch-database commands, and `npm run test:odoo` now exists. | `CLAUDE.md` "Check commands" |
| C5 | `AGENTS.md:155-165` | Codex-only model routing (Luna/Astra) and OpenCode wording. The owner now uses only Codex and Claude. The Codex rule is still valid for Codex; the OpenCode paragraph is dead. | owner answer 2026-10-13 |

## 3. Duplication inside `CLAUDE.md`

| Topic | Places | Proposed single home |
| --- | --- | --- |
| `sudo()` policy | R7 (line 55), "Product contracts" (191-198), "Odoo addon and API rules" (273 and the documented elevated-operations bullet) | the "Odoo addon and API rules" bullet; R7 keeps one line pointing to it |
| RTL, i18n, logical properties | "Product contracts" (180-183) and "Frontend and machine rules" (361-364 and following) | web rules |
| License header, LGPL-3, author, "serializers whitelist", "no OCA" | "Python and API conventions" (235-238) and "Odoo addon and API rules" (265-267, 285-288) | Odoo rules (also settles C2) |
| Scratch DB, `odoo19` ban, explicit addons path | "Unified product state" (163-169), "Safe worktree workflow" (209-231), "Verification boundary" (248-260), "Check commands" (398+) | one "Odoo scratch verification" block |
| Branch/worktree/push authorization | "Git workflow", "Safe worktree workflow", `AGENTS.md:48-51` | Git workflow |

## 4. Proposed structure

Constraint found: `.claude/*` is git-ignored in this repository, so Claude `.claude/rules/` files
(the path-scoped mechanism planned in D1) would not be tracked or shared with Codex. Use tracked
files under `docs/agents/` and a one-line "read before touching X" pointer instead. Codex and Claude
both follow such pointers.

| File | Content | Approx. lines |
| --- | --- | --- |
| `AGENTS.md` (single source) | product definition, UI entry point, R1-R10 (once), Git workflow (once), merge-preservation rules, safety and authorization, the verification commands, pointers to the two files below | 150-180 |
| `CLAUDE.md` | `@AGENTS.md` import plus Claude-only notes (agent tiers are global; Storybook note) | 10-20 |
| `docs/agents/odoo-rules.md` | "Odoo addon and API rules", "Python and API conventions", Odoo development section, the `sudo()` list, capability registration, check command block | 180-200 |
| `docs/agents/web-rules.md` | "Frontend and machine rules", the RTL/i18n/hydration rules, Storybook rule | 50-60 |
| Codex-only block | model routing kept in `AGENTS.md` under its own heading, OpenCode paragraph removed | 6 |

Net: 685 lines across two files becomes about 400 lines across four, with each rule stated once.
Only the always-needed part (`AGENTS.md`) loads at session start; the Odoo and web files load when
the task touches those layers.

## 5. Decisions needed from the owner

1. C1: which merge method is binding, `--no-ff` (as used so far) or fast-forward? The other text is
   then corrected.
2. C2: should the rule say "new addons start at `19.0.1.0.0`; bumps follow `docs/migrations.md`"
   (my recommendation) instead of a fixed version?
3. C5: confirm the OpenCode paragraph is removed and the Codex routing rule stays.
4. Approve the structure in section 4 (including moving the Odoo and web rules out of the
   always-loaded file), or choose to keep one file and only deduplicate.

## 6. How the change will be made safely (after approval)

1. Write a throwaway coverage script in the scratchpad: split every sentence of the current
   `CLAUDE.md` and `AGENTS.md` into normalized fingerprints, and after the edit assert that each
   fingerprint appears in the new set at least once, except entries on an explicit "intentional
   dedup" list that the owner reviews.
2. Move text without rewording; only remove exact duplicates and fix C1-C5 as decided.
3. `python3 -B tools/docs_policy.py` (extend its `DOCS` to the new files) and `npm test` pass.
4. One commit per file group; no change to R1-R10 wording, `tools/arch_layers.json` or the baseline.
5. The owner reviews the coverage report before merge.

## 7. Result (2026-10-13)

Owner answers: C1 `--no-ff`, C2 "a new addon starts at `19.0.1.0.0`; later bumps follow
`docs/migrations.md`", C5 OpenCode paragraph removed (Codex routing kept), structure approved.

Implemented as a verbatim move plus the edits above. Measured line counts (old to new):

| File | Before | After |
| --- | --- | --- |
| `CLAUDE.md` | 469 | 7 (imports `@AGENTS.md`) |
| `AGENTS.md` | 216 | 405 |
| `docs/agents/odoo-rules.md` | - | 184 |
| `docs/agents/web-rules.md` | - | 49 |
| Total | 685 | 645 |

The estimate in section 4 (about 400 total) was too low: text was moved without rewording, so
only exact duplicates were removed. A Claude session now always loads 412 lines (469 before);
Odoo and web rules load on demand. Shrinking `AGENTS.md` further (for example moving the
"Repository layout" section out) is a separate, optional step.

Sentence coverage check (345 unique sentences of the old files): 15 are absent from the new
files, all intentional: the Tailwind logical-properties bullet and the five "Python and API
conventions" sentences (each already stated in the Odoo and web rules), and the C1-C5 rewrites
(fast-forward wording, version numbers, pre-commit note, test-authorization note, OpenCode
paragraph, the `CLAUDE.md`-pointing sentences). The `sudo()` bullet was kept in `AGENTS.md`
because it complements, rather than repeats, the elevated-operations bullet in the Odoo rules.
