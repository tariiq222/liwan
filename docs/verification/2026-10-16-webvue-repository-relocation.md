# WebVue repository and workspace relocation

Date: 2026-10-16. Continuation of the owner-authorized namespace conversion, after local merge `ec88b4b0`. This records local relocation and verification; no code push or production deployment is implied.

## Completed changes

- The physical canonical checkout moved from `/Users/tariq/code/nasq` to `/Users/tariq/code/webvue`.
- The existing GitHub repository was renamed to `tariiq222/webvue`. Its numeric ID remains `1367683751`, node ID `R_kgDOUYUypw`, privacy remains private, default branch remains main, and permissions remain unchanged. Remote branch/tag listings before and after the rename were byte-identical. The new shared origin URL is `https://github.com/tariiq222/webvue.git`; read-only fetch succeeds. The old GitHub API route redirects to the same repository.
- Git repaired all 14 registered primary/linked worktrees, including nested and external worktrees. Immediate before/after checks proved unchanged HEAD, porcelain status and SHA-256 of every dirty/untracked regular file. Existing active work resumed afterward, so later HEAD/file changes by those owners are expected.
- Active instructions, workspace/testing/operations docs and the Bash safety guard now use the new canonical path and remote. Dated historical evidence, independent external evidence folders, reference downloads and `nasq-wt` locations retain their truthful names.
- The namespace regression guard no longer permits the retired canonical path or GitHub URL in active source. Two added real temp-Git cases failed before removing these exceptions and passed afterward. The separate unchanged reference-download exception remains truthful.
- Local Codex TOML trust/hook path keys migrated while preserving their values; an existing equivalent new-path trust entry was reused. Five existing active Claude project-path entries and its GitHub checkout-path cache migrated; historical missing entries remain unchanged. Backups are private ignored artifacts, never source files.
- This task repaired its own ignored venv shebangs/activation/config paths and regenerated Nuxt outputs. Canonical node_modules now has the current @webvue workspace links; cached earlier links remain available to older active processes. The active continuous-updates coordinator owns its own fixture/venv repairs and resumed from the new paths.

## Verification

Ignored detailed evidence is in `.superpowers/webvue-relocation/` in the rename worktree.

| Check | Result |
| --- | --- |
| Root npm test after relocation, isolated checkout | Exit 0; 810 Python and 3388 JavaScript tests |
| Namespace regressions | 3 passed; the new URL/path cases each observed RED before GREEN |
| Bash guard behavioral matrix | 6 passed: new-checkout mutation, explicit new checkout from Odoo, upstream read-only, blocked upstream mutation, blocked development DB tests and allowed scratch command |
| Architecture/Git/diff checks against current main | Exit 0 |
| Customer and vendor Nuxt prepare/type/build | Exit 0, generated and built from physical new paths |
| Restarted scratch Odoo | HTTP 200 on 8170; source/config/venv/classifier explicitly use the new path |
| Customer production browser against real scratch Odoo | 47 passed, no uncaught JS errors; includes CRUD, roles, session, lists, refresh and 12 responsive/locale/theme combinations |
| Vendor production browser after rebuilding on new path | 110 passed, exit 0 |
| Independent Sol/high read-only review | PASS; no Critical/Important findings |
| Worktree preservation | 14 immediate HEAD/status/hash comparisons passed |
| New GitHub identity/access/refs | Same ID/privacy/default branch/permissions; refs byte-identical; new origin fetch passed |

No old development database was renamed or deleted. No worker implementation was integrated by this relocation.

## Coordination and practical limits

The active continuous-updates chat explicitly reported a safe point for its coordinator and all three workers before cutover. Its two scratch Odoo processes were stopped by their owner, and after notification it resumed Git/Python/runtime checks from physical new paths. Other active writers and their resources were preserved.

`/Users/tariq/code/nasq` is now a temporary filesystem symlink to the physical new checkout. It keeps saved working directories, running tooling and older open chats functional. It is not a second source checkout or a product compatibility path. Codex does not expose a project-path update tool, and computer-use access to Codex was denied; its saved sidebar project/current-chat path therefore requires reopening the new folder through the app. This task did not bypass that restriction or edit app databases. Keep the alias until those clients are migrated; removal is separate coordinated cleanup.

The existing GitHub CI webhook had last-response HTTP 502 / connection_error before the rename, and its identity/events/active setting and failure status remained unchanged afterward. No Woodpecker server/agent or tunnel was running during inspection. Remote CI health is not established by local tests, and this task does not claim to have repaired the pre-existing CI outage or deployed a service.

Usage attribution remains incomplete: the coordinator snapshot succeeded, but the shared receipt adapter rejected participant attachment with KeyError participants. No exact total or quota-savings claim is made.
